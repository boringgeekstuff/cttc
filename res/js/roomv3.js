var magic = 1.61803398875;


var audio = {
	context: Function.lazy(()=>new AudioContext()),
	channels : 1,
	bufferSizeBySampleRate : {"44100":4096,"48000":8192}
};

function sequentialProcessing(fn,done=Function.nope){
	var processing = false;
	var queue = [];
	var cb = (result)=>{
		done(result);
		if(queue.length){
			if(queue.length>3){
				log('Queue too long ' + queue.length);
			}
			fn(queue.shift(),cb);
		}else{
			processing = false;
		}
	};
	return (data)=>{
		if(!processing){
			processing = true;
			fn(data,cb);
		}else{
			queue.push(data);
		}
	};
}


function recorder({context,channels}=audio){
	return navigator.mediaDevices.getUserMedia({audio:{
			autoGainControl:false,
			echoCancellation:true,
			noiseSuppression:true,
			sampleRate:context().sampleRate,
			channelCount:channels
	}}).then((stream)=>{
        var source = context().createMediaStreamSource(stream);
        var processor = context().createScriptProcessor(audio.bufferSizeBySampleRate[context().sampleRate], channels, channels);
        return {
        	start:function(){
        		source.connect(processor);
        		processor.connect(context().destination);
        		return this;
        	},
        	replaceConsumer:function(consumer){
				if(consumer){
					processor.onaudioprocess = (event)=>{
			            consumer(event.inputBuffer.getChannelData(0));
			        };
				}else{
					processor.onaudioprocess = null;
				}
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

function asBufferSource(buffer,sampleRate,{context,channels}=audio){
    buffer = new Float32Array(buffer);
    var source = context().createBufferSource();
    var abuffer = context().createBuffer(channels, buffer.length, sampleRate);
    for(var i=0;i<channels;i++){
        abuffer.copyToChannel(buffer,i,0);
    }
	source.buffer = abuffer;
	return source;
}

function player(sampleRate,{context,channels}=audio){
	log('player at ' + sampleRate)
	var queuedPlayer = sequentialProcessing((source,onEnded)=>{
    	source.onended = ()=>{
    		source.disconnect(context().destination);
    		onEnded();
    	};
    	source.connect(context().destination);
    	source.start(0);
    });
	return (buffer)=>(buffer.byteLength>0)?queuedPlayer(asBufferSource(buffer,sampleRate)):undefined;
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

function voipV3(url,sampleRate,shouldSend){
	return recorder().then(r=>{
		var play = player(sampleRate);
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
				r.replaceConsumer((buffer)=>{
					if(shouldSend(buffer)){
						ws.send(buffer);
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
			return {
				setStateChangeListener : fn=>stateChangeListener = fn,
				close : ()=>close()
			};
		},e=>{r.stop();throw e;});
	});
}

function connectToVoip(url,sampleRate,shouldSend,onDisconnect){
	var disconnectButton = document.getElementById('disconnectButton');
	function playDisconnectSound(){
		new Audio('/res/audio/disconnected.wav').play();
	}
	voipV3(url,sampleRate,shouldSend).then(voip=>{
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
	},(e)=>{log(e);playDisconnectSound();});
}

function connectToControl(){
	this.disabled = true;
	connectWebsocket('/control').then(ws=>{
		ws.setOnClose(()=>log('control close')).setOnMessage(data=>{
			data = JSON.parse(data);
			connectToVoip('/room/' + data.room,data.sampleRate,simpleThresholdAnalysisFunction,()=>this.disabled=false);
		}).send(JSON.stringify({sampleRate:audio.context().sampleRate}));
	})
}

document.getElementById('connectButton').addEventListener('click',connectToControl);

var globalSettings = {
	mute:false,
	threshold:0.006,
	skipFactor:4
};

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


function createStatTracker(table){
	table.innerHTML = '';
	var trackers = {};
	setInterval(()=>{
		Object.values(trackers).forEach((stat)=>{
			stat[0].innerHTML = stat[1];
			stat[1]=0;
		});
	},1000);
	return (stat,increment=1)=>{
		if(!trackers[stat]){
			trackers[stat] = [document.createElement('td'),0];
			var tr = document.createElement('tr');
			var title = document.createElement('td');
			title.innerHTML = stat;
			tr.appendChild(title);
			tr.appendChild(trackers[stat][0]);
			table.appendChild(tr);
		}
		trackers[stat][1]+=increment;
	};
}

// sound level analysis

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
