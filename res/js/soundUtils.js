var audio = {
	context: Function.lazy(()=>new AudioContext({latencyHint:'playback'})),
	channels : 1
};

var recordSettings = {
	autoGainControl:false,
	echoCancellation:true,
	noiseSuppression:true,
	googTypingNoiseDetection: false,
    googEchoCancellation: true,
    googEchoCancellation2: true,
    googAutoGainControl: false,
    googAutoGainControl2: false,
    googNoiseSuppression: true,
    googNoiseSuppression2: true
};

var recordSettingsNoProcessing = {
	autoGainControl:false,
	echoCancellation:false,
	noiseSuppression:true,
	googTypingNoiseDetection: false,
    googEchoCancellation: false,
    googEchoCancellation2: false,
    googAutoGainControl: false,
    googAutoGainControl2: false,
    googNoiseSuppression: true,
    googNoiseSuppression2: true
};


function recorder(recordSettings,{context,channels}=audio){
	return navigator.mediaDevices.getUserMedia({audio:{
			sampleRate:context().sampleRate,
			channelCount:channels,
			...recordSettings,
	}}).then((stream)=>{
        var source = context().createMediaStreamSource(stream);
        var processor = context().createScriptProcessor(4096, channels, channels);
        var consumer = null;

        processor.onaudioprocess = (event)=>{
        	if(consumer){
				consumer(event.inputBuffer.getChannelData(0));
			}
        };
        return {
        	start:function(){
        		source.connect(context().createGain()).connect(processor).connect(context().destination);
        		return this;
        	},
			replaceConsumer:function(c){
				consumer = c;
				return this;
        	},
        	stop:()=>{
        		processor.onaudioprocess = null;
        		source.disconnect();
            	processor.disconnect();
            	stream.getTracks().forEach(t=>t.stop());
        	}
        };
    })
}


function mp3convertor(sampleRate=audio.context().sampleRate,kbps=128,{channels}=audio){
	var mp3encoder = new lamejs.Mp3Encoder(channels,sampleRate,kbps);
	return {
		convert:(f32buffer)=>{
			var i16array = new Int16Array(f32buffer.length);
			for(var i in f32buffer){
				var v = f32buffer[i];
				i16array[i]=Math.floor(v*((v<0)?0x8000:0x7FFF));
			}
			return mp3encoder.encodeBuffer(i16array)
		},
		flush:()=>mp3encoder.flush()
	};
}

function briefSoundThresholdAnalysis(chunk,threshold,skipFactor){
	for(var i=0;i<(chunk.length>>skipFactor);i++){
    	var soundLevel = chunk[i<<skipFactor];
        if(soundLevel<-threshold || soundLevel>threshold){
            return true;
        }
    }
    return false;
}


function simpleThresholdAnalysisFunction(chunk,{threshold,skipFactor}=globalSettings){
	if(globalSettings.mute){
		return false;
	}
	for(var i=0;i<(chunk.length>>skipFactor);i++){
    	var soundLevel = chunk[i<<skipFactor];
        if(soundLevel<-threshold || soundLevel>threshold){
            return true;
        }
    }
    return false;
}

function analyseMaxSoundLevel(duration,analyseDelay=0){
	return recorder().then(r=>{
		r.start();
		return Promise.delay(analyseDelay).then(()=>{
			var max = -1;
			r.replaceConsumer((chunk)=>{
				max = chunk.reduce((p,c)=>Math.max(p,Math.abs(c)),max);
			});
			return Promise.delay(duration).then(()=>{
				r.stop();
				return max
			});
		})
	});
}

function comfortingNoise(loudness=globalSettings.threshold*Math.pow(magic,-4),{context}=audio){
	if(globalSettings.noComfortingNoise || document.getElementById('noNoise').checked){
		return Function.nope;
	}
    var node = context().createBufferSource();
    var alignment = 4096;
    var buffer = context().createBuffer(1, Math.floor(context().sampleRate/alignment)*alignment, context().sampleRate)
    data = buffer.getChannelData(0);
    for (var i = 0; i < data.length; i++) {
        data[i] = Math.random()*loudness;
    }    
    node.buffer = buffer;
    node.loop = true;
    node.connect(context().destination);
    node.start(0);
    return ()=>{
    	node.loop = false;
    	node.disconnect();
    };
}