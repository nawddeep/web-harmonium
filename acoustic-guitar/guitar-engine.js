// acoustic-guitar/guitar-engine.js

class GuitarEngine {
    constructor(audioContext, masterGainNode) {
        this.ctx = audioContext;
        this.masterOut = masterGainNode;
        this.samples = new Map();
        
        // Configurable User Settings
        this.strumDelay = 35; // Default cascade delay (ms)
        this.bodyWarmth = 50; // Body tone (1-100)
        this.stringBuzz = 5;  // Subtle inharmonic noise (0-10)
        this.sustain = false; // Sustain pedal tracking
        
        // Internal Effects
        this.chorus = this.createChorus();
        this.compressor = this.ctx.createDynamicsCompressor();
        
        // Compressor settings optimized for acoustic guitar dynamics
        this.compressor.threshold.value = -30;
        this.compressor.knee.value = 10;
        this.compressor.ratio.value = 4;
        this.compressor.attack.value = 0.01;
        this.compressor.release.value = 0.1;
        
        // Audio Chain: Pluck -> Chorus -> Compressor -> Master Out
        // The master out leads to the Harmonium's existing GainNode -> Reverb system
        this.chorus.connect(this.compressor);
        this.compressor.connect(this.masterOut);
        
        this.loadSamples();
    }
    
    // Light chorus to simulate the complex shimmering of an acoustic guitar
    createChorus() {
        const input = this.ctx.createGain();
        const delay = this.ctx.createDelay();
        delay.delayTime.value = 0.02; // 20ms base
        
        const lfo = this.ctx.createOscillator();
        lfo.frequency.value = 1.5; // Hz
        
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.value = 0.002;
        
        lfo.connect(lfoGain);
        lfoGain.connect(delay.delayTime);
        lfo.start();
        
        const wetGain = this.ctx.createGain();
        const dryGain = this.ctx.createGain();
        wetGain.gain.value = 0.3; // 30% wet mix
        dryGain.gain.value = 0.7; // 70% dry mix
        
        input.connect(delay);
        delay.connect(wetGain);
        input.connect(dryGain);
        
        const output = this.ctx.createGain();
        wetGain.connect(output);
        dryGain.connect(output);
        
        // Return the final output node but attach the input node for connection routing
        output.input = input;
        return output;
    }
    
    async loadSamples() {
        // Fallback to sample map if defined globally in guitar-samples.js
        if (typeof guitarSampleMap !== 'undefined') {
            for (const [note, url] of Object.entries(guitarSampleMap)) {
                try {
                    const response = await fetch(url);
                    const arrayBuffer = await response.arrayBuffer();
                    const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
                    this.samples.set(parseInt(note), audioBuffer);
                } catch(e) {
                    console.warn(`Failed to load acoustic guitar sample for MIDI note ${note}`, e);
                }
            }
        }
    }

    midiToFreq(midiNote) {
        return 440 * Math.pow(2, (midiNote - 69) / 12);
    }
    
    // Primary entry point for playing a note
    pluck(note, velocity = 100) {
        if (this.samples.has(note)) {
            // Sample Playback Mode
            const source = this.ctx.createBufferSource();
            source.buffer = this.samples.get(note);
            
            const gain = this.ctx.createGain();
            gain.gain.value = (velocity / 127);
            
            source.connect(gain);
            gain.connect(this.chorus.input);
            source.start();
        } else {
            // Synthesis Mode
            this.synthesizePluck(note, velocity);
        }
    }
    
    // Karplus-Strong Synthesis fallback algorithm
    synthesizePluck(note, velocity) {
        const freq = this.midiToFreq(note);
        if (freq <= 0) return;
        const delayTime = 1 / freq;
        
        const bufferSize = this.ctx.sampleRate * delayTime;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        
        const buzzFactor = this.stringBuzz / 10;
        
        // 1. Generate excitation burst (simulates striking the string)
        for (let i = 0; i < bufferSize; i++) {
            let noise = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 3);
            if (buzzFactor > 0 && i % Math.floor(bufferSize / 4) === 0) {
                noise += (Math.random() * buzzFactor); // Add subtle string buzz/inharmonicity
            }
            data[i] = noise;
        }
        
        const burstSource = this.ctx.createBufferSource();
        burstSource.buffer = buffer;
        
        // 2. Setup Delay Loop
        const feedback = this.ctx.createGain();
        feedback.gain.value = this.sustain ? 0.998 : 0.985; // Ring longer if sustained
        
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 2000 + (100 - this.bodyWarmth) * 40; // Tone control mapping
        
        const delay = this.ctx.createDelay(1);
        delay.delayTime.value = delayTime;
        
        const outputGain = this.ctx.createGain();
        outputGain.gain.value = (velocity / 127) * 2.5; 
        
        // 3. Connect Graph
        burstSource.connect(delay);
        delay.connect(filter);
        filter.connect(feedback);
        feedback.connect(delay); // Bridge the feedback loop
        
        delay.connect(outputGain);
        outputGain.connect(this.chorus.input);
        
        // 4. Fire Excitation
        burstSource.start();
        
        // 5. Cleanup nodes after note finishes naturally
        const decayTime = this.sustain ? 8.0 : 4.0;
        setTimeout(() => {
            // Soft release target to prevent clicks
            feedback.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
            setTimeout(() => {
                try {
                    burstSource.disconnect();
                    delay.disconnect();
                    filter.disconnect();
                    feedback.disconnect();
                    outputGain.disconnect();
                } catch(e) {}
            }, 500);
        }, decayTime * 1000);
    }
    
    // Builds and fires a chord sequence simulating a real guitar strum
    strum(notes, direction = 'down', velocity = 100) {
        if (!notes || notes.length === 0) return;
        
        let sortedNotes = [...notes].sort((a,b) => a - b);
        if (direction === 'up') {
            sortedNotes.reverse();
        }
        
        sortedNotes.forEach((note, index) => {
            setTimeout(() => {
                this.pluck(note, velocity);
            }, index * this.strumDelay);
        });
    }
}
