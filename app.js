document.addEventListener('DOMContentLoaded', function () {
    const video = document.getElementById('video');
    const canvas = document.getElementById('myCanvas');
    const canvasContext = canvas.getContext('2d');
    let audioContext;
    let analyser;
    let waveform, wavesurfer;
    let record
let scrollingWaveform = false
let continuousWaveform = true

    if (Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource('https://cleanstreamsenhslbucket.s3.ap-southeast-2.amazonaws.com/EncoderTest/EncoderUnit_1.m3u8');
        hls.attachMedia(video);

        // Add event listeners for HLS
        hls.on(Hls.Events.FRAG_CHANGED, function (event, data) {
            console.log('Fragment changed:', data.frag.url);
           
        });
    } else {
        console.error('HLS not supported');
    }

    document.getElementById('playButton').addEventListener('click', function () {
     
        if (!audioContext) {
        // Create a new AudioContext on user interaction
        audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // Setup audio nodes
        const track = audioContext.createMediaElementSource(video);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        const gainNode = audioContext.createGain(); // Create a GainNode

        // Connect track to GainNode, and GainNode to other destinations
        track.connect(gainNode);
        gainNode.connect(analyser);
        gainNode.connect(audioContext.destination); // Connect GainNode to destination to keep audio output
    }

    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
       

        if (record.isRecording || record.isPaused) {
          record.stopRecording()
          recButton.textContent = 'Record'
          pauseButton.style.display = 'none'
          return
        }
      
        recButton.disabled = true
      
        // reset the wavesurfer instance
      
        
        // Assume record.startRecording() now needs a MediaStream instead of MediaElementSource
    if (video.captureStream) {
      const mediaStream = video.captureStream();
      record.startRecording({ mediaStream }).then(() => {
          recButton.textContent = 'Stop';
          recButton.disabled = false;
          pauseButton.style.display = 'inline';
      });
  } else {
      console.error('captureStream method not supported by this browser.');
      recButton.disabled = false;
  }

        video.play();
        
        requestAnimationFrame(draw);
    });

    function draw() {
        if (!analyser) return; // Exit if analyser is not setup yet

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        canvas.width = window.innerWidth;
        canvas.height = 255;
        canvasContext.clearRect(0, 0, canvas.width, canvas.height);

        const barWidth = (canvas.width / bufferLength) * 2.5;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
            const barHeight = dataArray[i];
            canvasContext.fillStyle = `rgb(${barHeight+100},50,50)`;
            canvasContext.fillRect(x, canvas.height - barHeight / 2, barWidth, barHeight / 2);
            x += barWidth + 1;
        }

        requestAnimationFrame(draw);
    }

   
    const createWaveSurfer = () => {
      // Destroy the previous wavesurfer instance
      if (wavesurfer) {
        wavesurfer.destroy()
      }
    
      // Create a new Wavesurfer instance
      wavesurfer = WaveSurfer.create({
        container: '#mic',
        waveColor: 'rgb(200, 0, 200)',
        progressColor: 'rgb(100, 0, 100)',
      })
    
      // Initialize the Record plugin
      record = wavesurfer.registerPlugin(
        globalThis.WaveSurfer.HLSPlugin.create({
          renderRecordedAudio: false,
          scrollingWaveform,
          continuousWaveform,
          continuousWaveformDuration: 30, // optional
        }),
      )
    
      // Render recorded audio
      record.on('record-end', (blob) => {
        const container = document.querySelector('#recordings')
        const recordedUrl = URL.createObjectURL(blob)
    
        // Create wavesurfer from the recorded audio
        const wavesurfer = WaveSurfer.create({
          container,
          waveColor: 'rgb(200, 100, 0)',
          progressColor: 'rgb(100, 50, 0)',
          url: recordedUrl,
        })
    
        // Play button
        const button = container.appendChild(document.createElement('button'))
        button.textContent = 'Play'
        button.onclick = () => wavesurfer.playPause()
        wavesurfer.on('pause', () => (button.textContent = 'Play'))
        wavesurfer.on('play', () => (button.textContent = 'Pause'))
    
        // Download link
        const link = container.appendChild(document.createElement('a'))
        Object.assign(link, {
          href: recordedUrl,
          download: 'recording.' + blob.type.split(';')[0].split('/')[1] || 'webm',
          textContent: 'Download recording',
        })
      })
      pauseButton.style.display = 'none'
      recButton.textContent = 'Record'
    
      record.on('record-progress', (time) => {
        updateProgress(time)
      })
    }

    const progress = document.querySelector('#progress')
const updateProgress = (time) => {
  // time will be in milliseconds, convert it to mm:ss format
  const formattedTime = [
    Math.floor((time % 3600000) / 60000), // minutes
    Math.floor((time % 60000) / 1000), // seconds
  ]
    .map((v) => (v < 10 ? '0' + v : v))
    .join(':')
  progress.textContent = formattedTime
}

const pauseButton = document.querySelector('#pause')
pauseButton.onclick = () => {
  if (record.isPaused) {
    record.resumeRecording()
    pauseButton.textContent = 'Pause'
    return
  }

  record.pauseRecording()
  pauseButton.textContent = 'Resume'
}

const micSelect = document.querySelector('#mic-select')
{
  // Mic selection
  globalThis.WaveSurfer.HLSPlugin.getAvailableAudioDevices().then((devices) => {
    devices.forEach((device) => {
      const option = document.createElement('option')
      option.value = device.deviceId
      option.text = device.label || device.deviceId
      micSelect.appendChild(option)
    })
  })
}
// Record button
const recButton = document.querySelector('#record')

recButton.onclick = () => {
 
}

document.querySelector('#scrollingWaveform').onclick = (e) => {
  scrollingWaveform = e.target.checked
  if (continuousWaveform && scrollingWaveform) {
    continuousWaveform = false
    document.querySelector('#continuousWaveform').checked = false
  }
  createWaveSurfer()
}

document.querySelector('#continuousWaveform').onclick = (e) => {
  continuousWaveform = e.target.checked
  if (continuousWaveform && scrollingWaveform) {
    scrollingWaveform = false
    document.querySelector('#scrollingWaveform').checked = false
  }
  createWaveSurfer()
}
createWaveSurfer();

});
