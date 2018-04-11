var magic = 1.61803398875;


var audio = {
	context: Function.lazy(()=>new AudioContext({latencyHint:'playback'})),
	channels : 1
};

var globalSettings = {
	mute:false,
	threshold:0.03,
	briefSkipFactor:4,
	noComfortingNoise:false
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
        		source.connect(processor);
        		processor.connect(context().destination);
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





function bufferUpPlayer(){
	var buffers = [];
	return {
		play : b=>buffers.push(b),
		get : _=>buffers
	};
}

function updateTracker(player,checkTime){
	function now(){
		return new Date().valueOf();
	}
	var lastUpdated = now();
	var interval = setInterval(()=>{
		if(!player.busy() && (now() - lastUpdated) > checkTime){
			log('Tracker stops player');
			player.stop();
		}
	},checkTime);
	return {
		trackUpdate : ()=>lastUpdated = now(),
		stop : ()=>clearInterval(interval)
	};
}
var playerCounter = 0;
function SimpleMP3Player(initialBuffers, mimeCodec){
	var playerId = ++playerCounter;
	var log = (...args)=>window.log(...args,playerId);
	var queue = [...initialBuffers];
	var stopping = false;
	var audio = new Audio();
	var source = new MediaSource();
	audio.src = URL.createObjectURL(source);
	var control = {
		play : $=>audio.play(),
		appendBuffer : b=>queue.push(b),
		endOfStream : fn=>{
			stopping=true;
			audio.onended = fn;
		}
	};
	source.addEventListener('sourceopen', function(){
		var sourceBuffer = source.addSourceBuffer(mimeCodec);
		sourceBuffer.addEventListener('updateend', ()=>{
			if(queue.length>0){
				sourceBuffer.appendBuffer(queue.shift());
			}else if(stopping){
				source.endOfStream();
			}
		});
		sourceBuffer.appendBuffer(queue.shift());
		control.appendBuffer = b=>{
			if(sourceBuffer.updating){
				queue.push(b);
			}else{
				sourceBuffer.appendBuffer(b);
			}
		};
		control.endOfStream = fn=>{
			stopping = true;
			if(queue.length===0 && !sourceBuffer.updating && source.readyState === 'open'){
				source.endOfStream();
			}
			audio.onended = fn;
		};
	});
	return control;
}

function justCallCB(cb){
	return cb();
}

function now(){
	return new Date().valueOf();
}

function yetAnotherMP3Player(expectedBufferInterval, timeFlush, mimeCodec='audio/mpeg'){
	var currentPlayer;
	var schedulePlay = justCallCB;
	function flushCurrent(){
		var nextPlay;
		schedulePlay = fn=>nextPlay=fn;
		currentPlayer.endOfStream($=>nextPlay?nextPlay():(schedulePlay=justCallCB));
		currentPlayer = null;
	}
	var lastBuffer = now();
	if(timeFlush){
		var interval = setInterval($=>{
			if(currentPlayer && now() - lastBuffer > expectedBufferInterval){
				flushCurrent();
			}
		},expectedBufferInterval);
	}
	return b=>{
		lastBuffer = now();
		var isFlushBuffer = b.byteLength<1000;
		if(currentPlayer){
			currentPlayer.appendBuffer(b);
		}else{
			currentPlayer = new SimpleMP3Player([b],mimeCodec);
			schedulePlay(currentPlayer.play);
		}
		if(isFlushBuffer){
			flushCurrent();
		}
	};
}

function mp3convertor(sampleRate=audio.context().sampleRate,kbps=128,{channels}=audio){
	var mp3encoder = new lamejs.Mp3Encoder(channels,sampleRate,kbps);
	return {
		convert:(f32buffer)=>mp3encoder.encodeBuffer(new Int16Array(f32buffer.map((s)=>(s<0)?s*0x8000:s*0x7FFF))),
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

function connectWebsocket(url){
	return new Promise((resolve,reject)=>{
		var ws = new WebSocket('ws'+window.location.origin.substring(4) + url);
		ws.binaryType = 'arraybuffer';
		ws.onerror = reject;
		ws.onopen = ()=>{
			ws.onerror = null;
			return resolve({
				send : (d)=>ws.send(d),
				setOnMessage : function(fn){ws.onmessage = (event)=>fn(event.data); return this;},
				setOnClose : function(fn){ws.onclose = fn;return this;},
				close : ()=>ws.close()
			});
		};
	})
}

function voipV3(url,shouldSend,filter,timeFlush){
	return recorder(filter?recordSettings:recordSettingsNoProcessing).then(r=>{
		play = yetAnotherMP3Player(100,timeFlush);
		var stateChangeListener = Function.nope;
		var close = Function.nope;
		var disconnecting = false;
		function connect(){
			return connectWebsocket(url).then((ws)=>{
				close = ()=>{
					disconnecting = true;
					ws.close()
				};
				stateChangeListener('active');
				var convertor = mp3convertor();
				r.replaceConsumer(data=>{
					if(shouldSend(data)){
						data = convertor.convert(data);
					}else{
						data = convertor.flush();
					}
					if(data.length>0){
						ws.send(data);
					}
				});
				ws.setOnMessage(e=>{
					play(e);
				}).setOnClose(()=>{
					close = Function.nope;
					r.replaceConsumer(null);
					if(disconnecting){
						r.stop();
						stateChangeListener('disconnected');
					}else{
						stateChangeListener('reconnecting');
						connect().catch(e=>{
							r.stop();
							stateChangeListener('disconnected');
						})
					}
				});
			});
		}
		
		return connect().then(()=>{
			r.start();
			url+='/1000';
			return {
				setStateChangeListener : fn=>stateChangeListener = fn,
				close : ()=>close()
			};
		},e=>{r.stop();throw e;});
	});
}

function connectToVoip(url,shouldSend,onDisconnect,filter,timeFlush){
	var disconnectButton = document.getElementById('disconnectButton');
	function playDisconnectSound(){
		new Audio('/res/audio/disconnected.wav').play();
	}
	voipV3(url,shouldSend,filter,timeFlush).then(voip=>{
		new Audio('/res/audio/connected.wav').play();
		var stopNoise = comfortingNoise();
		window.onbeforeunload = voip.close;
		disconnectButton.disabled=false;
		disconnectButton.addEventListener('click',voip.close);
		voip.setStateChangeListener(state=>{
			switch(state){
				case 'active':
					disconnectButton.disabled = false;
					stopNoise = comfortingNoise();
					break;
				case 'reconnecting':
					disconnectButton.disabled = true;
					stopNoise();
					break;
				case 'disconnected':
					stopNoise();
					window.onbeforeunload = null;
					document.getElementById('connectButton').disabled = false;
					disconnectButton.disabled = true;
					disconnectButton.removeEventListener('click', voip.close);
					playDisconnectSound();
					onDisconnect()
					break;
			}
		});
	},(e)=>{log(e);playDisconnectSound();onDisconnect();});
}

document.getElementById('connectButton').addEventListener('click',function(){
	this.disabled=true;
	connectToVoip('/room/' + 1,simpleThresholdAnalysisFunction,()=>this.disabled=false,document.getElementById('noFilter').checked,document.getElementById('timeFlush').checked);
});


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

document.getElementById('muteButton').addEventListener('click',function(){
	this.innerHTML = (globalSettings.mute = !globalSettings.mute)?'Включить микрофон':'Выключить микрофон';
});

document.getElementById('calibrateButton').addEventListener('click',function(){
	alert('Оценка фонового шума, после нажатия OK в течении 4 секунд постарайтесь поддерживать тишину');
	analyseMaxSoundLevel(2000,1000).then((silenceMax)=>{	
		alert('Оценка уровня звука при разговоре, после нажатия OK в течении 4 секунд скажите несколько слов обычным голосом');
		return analyseMaxSoundLevel(3000).then(voiceMax=>{
			if(silenceMax==0 || voiceMax==0){
				alert('Зафиксирован нулевой уровень звука, возможно микрофон не подключен или работает некорректно');
			}else if(silenceMax*magic*magic>voiceMax){
				alert('Разница между тишиной и голосом слишком маленькая, возможно тест проведенн некорректно');
			}else{
				log(globalSettings.threshold=silenceMax*magic);
				alert('Похоже, все хорошо. Настройки фонового шума обновлены');				
			}
		})
	});
});
