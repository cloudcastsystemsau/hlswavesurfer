!(function (global, factory) {
    if (typeof exports === "object" && typeof module !== "undefined") {
        module.exports = factory();
    } else if (typeof define === "function" && define.amd) {
        define(factory);
    } else {
        (global = typeof globalThis !== "undefined" ? globalThis : global || self).WaveSurfer = global.WaveSurfer || {};
        global.WaveSurfer.HLSPlugin = factory();
    }
}(this, function () {
    "use strict";

    // Timer class as used in the TypeScript source
    class Timer {
        constructor() {
            this.listeners = new Set();
            this.isRunning = false;
        }

        onTick(callback) {
            this.listeners.add(callback);
        }

        start() {
            this.isRunning = true;
            const tick = () => {
                if (!this.isRunning) return;
                this.listeners.forEach(listener => listener());
                requestAnimationFrame(tick);
            };
            tick();
        }

        stop() {
            this.isRunning = false;
        }
    }

    class BasePlugin {
        constructor(options) {
            this.options = options;
            this.subscriptions = [];
            this.eventHandlers = {};
        }
    
        emit(event, ...args) {
            const handlers = this.eventHandlers[event];
            if (handlers) {
                handlers.forEach(handler => handler(...args));
            }
        }
    
        once(event, callback) {
            const wrapper = (...args) => {
                this.off(event, wrapper);
                callback(...args);
            };
            this.on(event, wrapper);
            return () => this.off(event, wrapper);
        }
    
        on(event, callback) {
            if (!this.eventHandlers[event]) {
                this.eventHandlers[event] = [];
            }
            this.eventHandlers[event].push(callback);
            // Store the unsubscribe function to help with cleanup
            this.subscriptions.push(() => this.off(event, callback));
        }
    
        off(event, callback) {
            if (this.eventHandlers[event]) {
                this.eventHandlers[event] = this.eventHandlers[event].filter(handler => handler !== callback);
            }
        }
    
        /**
         * Called after this.wavesurfer is available.
         * Can be overridden in subclass to perform setup that requires Wavesurfer instance.
         */
        onInit() {
            // This method can be overridden in subclasses.
        }
    
        /**
         * Internal method called by WaveSurfer to initialize the plugin.
         * @param wavesurfer - The WaveSurfer instance.
         */
        _init(wavesurfer) {
            this.wavesurfer = wavesurfer;
            this.onInit();
        }
    
        /**
         * Destroy the plugin and unsubscribe from all events.
         * This method cleans up the plugin, ensuring no memory leaks.
         */
        destroy() {
            this.emit('destroy');
          //  this.subscriptions.forEach(unsubscribe => unsubscribe());
            this.subscriptions = [];  // Clear the subscriptions array to ensure clean up.
            this.eventHandlers = {};  // Clear event handlers
        }
    }
    
    const MIME_TYPES = ['audio/webm', 'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/mp3'];

    // RecordPlugin class fully restructured based on TypeScript source
    class HLSPlugin extends BasePlugin {
        constructor(options) {
            // Define default values
            const DEFAULT_BITS_PER_SECOND = 128000;  // Example default value
            const DEFAULT_SCROLLING_WAVEFORM_WINDOW = 5;  // Example default value
    
            // Merge options with defaults
            const mergedOptions = {
                audioBitsPerSecond: options.audioBitsPerSecond !== undefined ? options.audioBitsPerSecond : DEFAULT_BITS_PER_SECOND,
                scrollingWaveform: options.scrollingWaveform !== undefined ? options.scrollingWaveform : false,
                scrollingWaveformWindow: options.scrollingWaveformWindow !== undefined ? options.scrollingWaveformWindow : DEFAULT_SCROLLING_WAVEFORM_WINDOW,
                continuousWaveform: options.continuousWaveform !== undefined ? options.continuousWaveform : false,
                renderRecordedAudio: options.renderRecordedAudio !== undefined ? options.renderRecordedAudio : true,
                mediaRecorderTimeslice: options.mediaRecorderTimeslice !== undefined ? options.mediaRecorderTimeslice : undefined,
                videoElement: document.getElementById('video'),
            };
    
            // Call the superclass constructor with the merged options
            super(mergedOptions);
    
            // Additional initializations specific to AudioRecorder
            this.stream = null;
            this.mediaRecorder = null;
            this.dataWindow = null;
            this.isWaveformPaused = false;
            this.originalOptions = undefined;
            this.isRecording = false;
            this.timer = new Timer();  // Assuming Timer is already defined elsewhere
            this.lastStartTime = 0;
            this.lastDuration = 0;
            this.duration = 0;
    
            // Subscriptions to handle events
            this.subscriptions.push({
                event: 'tick',
                callback: () => {
                    const currentTime = performance.now() - this.lastStartTime;
                    this.duration = this.isPaused() ? this.duration : this.lastDuration + currentTime;
                    this.emit('record-progress', this.duration);
                }
            });
        }
    

        static create(options) {
            return new HLSPlugin(options || {});
        }


       

        startMic(options) {
            return new Promise((resolve, reject) => {
                try {
                    const micStream = this.renderMicStream(options.mediaStream);
                    this.once('destroy', () => micStream.onDestroy());
                    this.once('record-end', () => micStream.onEnd());
        
                    resolve(options.mediaStream); // Successfully resolve the promise with the media stream
                } catch (error) {
                    reject(error); // Reject the promise if an error occurs
                }
            });
        }

        stopMic() {
            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop());
                this.stream = null;
                this.mediaRecorder = null;
            }
        }

        stopRecording(){
            if (this.isActive){
               
                    this.mediaRecorder?.stop()
                    this.timer.stop()
                  
            }
        }

        startRecording(options) {
            return this.startMic(options).then(stream => {
                this.dataWindow = null;
                const mediaRecorder = this.mediaRecorder || new MediaRecorder(stream, {
                    mimeType: this.options.mimeType || MIME_TYPES.find(mt => MediaRecorder.isTypeSupported(mt)),
                    audioBitsPerSecond: this.options.audioBitsPerSecond
                });
                this.mediaRecorder = mediaRecorder;
                this.stopRecording();

                const recordedChunks = [];

                mediaRecorder.ondataavailable = event => {
                    if (event.data.size > 0) {
                        recordedChunks.push(event.data);
                        this.emit('record-data-available', event.data);
                    }
                };

                mediaRecorder.onstop = () => {
                    const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
                    this.emit('record-end', blob);
                    if (this.options.renderRecordedAudio) {
                        this.applyOriginalOptionsIfNeeded();
                        this.wavesurfer.load(URL.createObjectURL(blob));
                    }
                };

                mediaRecorder.start(this.options.mediaRecorderTimeslice);
                this.lastStartTime = performance.now();
                this.lastDuration = 0;
                this.duration = 0;
                this.isWaveformPaused = false;
                this.timer.start();
                this.emit('record-start');
            });
        }

        renderMicStream(mediaStream) {
            const audioContext = new AudioContext();
            const source = audioContext.createMediaStreamSource(mediaStream);
            const analyser = audioContext.createAnalyser();
            source.connect(analyser);
        
            if (this.options.continuousWaveform) {
                analyser.fftSize = 32;
            }
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Float32Array(bufferLength);
        
            let sampleIdx = 0;
        
            if (this.wavesurfer) {
                this.originalOptions = this.originalOptions || {
                    ...this.wavesurfer.options,
                };
        
                this.wavesurfer.options.interact = false;
                if (this.options.scrollingWaveform) {
                    this.wavesurfer.options.cursorWidth = 0;
                }
            }
        
            const drawWaveform = () => {
                if (this.isWaveformPaused) return;
        
                analyser.getFloatTimeDomainData(dataArray);
        
                if (this.options.scrollingWaveform) {
                    // Scrolling waveform
                    const windowSize = Math.floor((this.options.scrollingWaveformWindow || 0) * audioContext.sampleRate);
                    const newLength = Math.min(windowSize, this.dataWindow ? this.dataWindow.length + bufferLength : bufferLength);
                    const tempArray = new Float32Array(windowSize); // Always make it the size of the window, filling with zeros by default
        
                    if (this.dataWindow) {
                        const startIdx = Math.max(0, windowSize - this.dataWindow.length);
                        tempArray.set(this.dataWindow.slice(-newLength + bufferLength), startIdx);
                    }
        
                    tempArray.set(dataArray, windowSize - bufferLength);
                    this.dataWindow = tempArray;
                } else if (this.options.continuousWaveform) {
                    // Continuous waveform
                    if (!this.dataWindow) {
                        const size = this.options.continuousWaveformDuration
                            ? Math.round(this.options.continuousWaveformDuration * 100)
                            : (this.wavesurfer ? this.wavesurfer.getWidth() : 0) * window.devicePixelRatio;
                        this.dataWindow = new Float32Array(size);
                    }
        
                    let maxValue = 0;
                    for (let i = 0; i < bufferLength; i++) {
                        const value = Math.abs(dataArray[i]);
                        if (value > maxValue) {
                            maxValue = value;
                        }
                    }
        
                    if (sampleIdx + 1 > this.dataWindow.length) {
                        const tempArray = new Float32Array(this.dataWindow.length * 2);
                        tempArray.set(this.dataWindow, 0);
                        this.dataWindow = tempArray;
                    }
        
                    this.dataWindow[sampleIdx] = maxValue;
                    sampleIdx++;
                } else {
                    this.dataWindow = dataArray;
                }
        
                // Render the waveform
                if (this.wavesurfer) {
                    const totalDuration = (this.dataWindow ? this.dataWindow.length : 0) / 100;
                    this.wavesurfer
                        .load(
                            '',
                            [this.dataWindow],
                            this.options.scrollingWaveform ? this.options.scrollingWaveformWindow : totalDuration,
                        )
                        .then(() => {
                            if (this.wavesurfer && this.options.continuousWaveform) {
                                this.wavesurfer.setTime(this.getDuration() / 1000);
        
                                if (!this.wavesurfer.options.minPxPerSec) {
                                    this.wavesurfer.setOptions({
                                        minPxPerSec: this.wavesurfer.getWidth() / this.wavesurfer.getDuration(),
                                    });
                                }
                            }
                        })
                        .catch((err) => {
                            console.error('Error rendering real-time recording data:', err);
                        });
                }
            };
        
            const FPS = 100; // Define FPS if not defined globally
            const intervalId = setInterval(drawWaveform, 1000 / FPS);
        
            return {
                onDestroy: function () {
                    clearInterval(intervalId);
                    if (source.disconnect) source.disconnect();
                    if (audioContext.close) audioContext.close();
                },
                onEnd: () => {
                    this.isWaveformPaused = true;
                    clearInterval(intervalId);
                    this.stopMic();
                },
            };
        }
        

        applyOriginalOptionsIfNeeded() {
            if (this.wavesurfer && this.originalOptions) {
                this.wavesurfer.setOptions(this.originalOptions);
                delete this.originalOptions;
            }
        }

        static getAvailableAudioDevices() {
            return navigator.mediaDevices
              .enumerateDevices()
              .then((devices) => devices.filter((device) => device.kind === 'audioinput'))
          }

        destroy() {
            this.applyOriginalOptionsIfNeeded();
            super.destroy();
            this.stopRecording();
            this.stopMic();
        }

        getDuration() {
            return this.duration;
        }
        
        /**
         * Check if the audio is currently being recorded.
         * @returns {boolean} True if the recording is in progress, false otherwise.
         */
        static isRecording() {
            return this.mediaRecorder && this.mediaRecorder.state === 'recording';
        }
        
        /**
         * Check if the recording is currently paused.
         * @returns {boolean} True if the recording is paused, false otherwise.
         */
       static isPaused() {
            return this.mediaRecorder && this.mediaRecorder.state === 'paused';
        }
        
        /**
         * Check if the media recorder is active (recording or paused).
         * @returns {boolean} True if the recorder is active, false if it is inactive.
         */
        isActive() {
            return this.mediaRecorder && this.mediaRecorder.state !== 'inactive';
        }
    }

    return HLSPlugin;
}));
