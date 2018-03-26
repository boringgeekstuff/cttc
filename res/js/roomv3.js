var magic = 1.61803398875;


var audio = {
	context: Function.lazy(()=>new AudioContext({latencyHint:'playback'})),
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
			googAutoGainControl:false,
			echoCancellation:true,
			noiseSuppression:true,
			sampleRate:context().sampleRate,
			channelCount:channels
	}}).then((stream)=>{
        var source = context().createMediaStreamSource(stream);
        var processor = context().createScriptProcessor(audio.bufferSizeBySampleRate[context().sampleRate], channels, channels);
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

function mp3convertor(sampleRate=audio.context().sampleRate,kbps=128,{channels}=audio){
	var mp3encoder = new lamejs.Mp3Encoder(channels,sampleRate,kbps);
	return {
		convert:(f32buffer)=>mp3encoder.encodeBuffer(new Int16Array(f32buffer.map((s)=>(s<0)?s*0x8000:s*0x7FFF))),
		flush:()=>mp3encoder.flush()
	};
}

function mp3player(sampleRate,flushInterval,mimeCodec='audio/mpeg'){
	var audio = new Audio();
	var source = new MediaSource();
	audio.src = URL.createObjectURL(source);
	var silenceGenerator = mp3convertor(sampleRate);

	function generateSilence(length){
		return silenceGenerator.convert(new Float32Array(Math.ceil(length*sampleRate)));
	}

	return new Promise((resolve)=>{
		log('create player');
		source.addEventListener('sourceopen', function(){
			if(source.sourceBuffers.length > 0){
				return;
			}
			log('source open');
			var sourceBuffer = null;
			var queue = [];
			var flushingPhase = 0;
			var flushIntervalId = false && setInterval(()=>{
				if(!sourceBuffer.updating){
					if(queue.length>0){
						flushingPhase = 0;
						sourceBuffer.appendBuffer(queue.shift());
					}else{
						if(sourceBuffer.buffered.length>0){
							if(flushingPhase>0){
								var length = sourceBuffer.buffered.end(0) - audio.currentTime;
								var flush = Math.min(flushInterval/1000,length)/flushingPhase;
								log('flushing ' + length + ' ' + flush);
								sourceBuffer.appendBuffer(generateSilence(flush));
							}
							if(flushingPhase>15){
								source.removeSourceBuffer(sourceBuffer);
							}
						}
						flushingPhase++;
					}
				}
			}, flushInterval);
			function createBuffer(){
				if(!sourceBuffer){
					sourceBuffer = source.addSourceBuffer(mimeCodec);
					log(source.sourceBuffers);
					sourceBuffer.addEventListener('updateend', ()=>{
						if(!sourceBuffer.updating){
							if(queue.length>0){
								sourceBuffer.appendBuffer(queue.shift());
							}else{
								log('remove');
								//source.removeSourceBuffer(sourceBuffer);
								//sourceBuffer = null;
								source.endOfStream();
							}
						}else{
							log('state bugged');
						}
					});
				}else{
					log('exists');
				}
			}
			resolve(i16buffer=>{
				createBuffer();
				if(sourceBuffer.updating){
					queue.push(i16buffer);
				}else{
					sourceBuffer.appendBuffer(i16buffer);
				}
			});
		});
		audio.play();
	});
}


function mp3Nextplayer(sampleRate,expectedUpdateRate,mimeCodec='audio/mpeg'){
	function now(){
		return new Date().valueOf();
	}
	function createPlayer(buffer){
		var audio = new Audio();
		var source = new MediaSource();
		audio.src = URL.createObjectURL(source);
		var bufferQueue = [buffer];
		source.addEventListener('sourceopen', function(){
			log('open');
			var sourceBuffer = source.addSourceBuffer(mimeCodec);
			var queue = [];
			var lastUpdated = now();
			var updateCheckInterval = setInterval(_=>{
				if(!sourceBuffer.updating){
					if(queue.length>0){
						log('Wrong state fix');
						sourceBuffer.appendBuffer(queue.shift());
					}else if(now() - lastUpdated > expectedUpdateRate){
						log('close idle audio');
						clearInterval(updateCheckInterval);
						source.endOfStream();
						var residualBuffer = [];
						play = b=>residualBuffer.push(b)
						audio.onended = ()=>{
							log('ended');
							play = createPlayer;
							residualBuffer.forEach(b=>play(b));
						};
					}
				}
			},expectedUpdateRate);
			sourceBuffer.addEventListener('updateend', ()=>{
				if(sourceBuffer.updating){
					log('Wrong player state');
				}else if(queue.length>0){
					log('repush');
					sourceBuffer.appendBuffer(queue.shift());
				}
			});
			var player = (i16buffer)=>{
				lastUpdated = now();
				if(sourceBuffer.updating){
					log('queue');
					queue.push(i16buffer);
				}else{
					log('push');
					sourceBuffer.appendBuffer(i16buffer);
				}
			}
			bufferQueue.forEach(player);
			play = player;
		});

		audio.play().then(_=>log('ok'),log);
		play = b=>bufferQueue.push(b);
	};

	var play = createPlayer;

	return i16buffer=>play(i16buffer);
}


function player(sampleRate,{context,channels}=audio){
	log('player at ' + sampleRate);
	var currentSource = null;
	return (buffer)=>{
		var source = asBufferSource(buffer,sampleRate);
		source.connect(context().destination);
		if(currentSource){
			currentSource.onended = ()=>source.start(0);
		}else{
			source.start(0);
		}
		source.onended = ()=>currentSource=null;
		currentSource = source;
	};
}

function createSoundBufferingProcessor(flushThreshold,cb){
	var buffers = [];
	function flush(){
		if(buffers.length>0){
			cb(float32Concat(buffers.splice(0)));
		}
	}
	return (chunk)=>{
		if(globalSettings.mute){
			flush();
		}else{
			if(briefSoundThresholdAnalysis(chunk,globalSettings.threshold,globalSettings.briefSkipFactor)){
				let length = 1<<globalSettings.thoroughFactor;
				for(var from=chunk.length-length;from>=0;from-=length){
					if(!soundThresholdAnalysis(chunk,from,length,globalSettings.threshold)){
						if(from>0){
							buffers.push(chunk.slice(0,from));
						}
						flush();
						if(from+length<chunk.length){
							buffers.push(chunk.slice(from+length));
						}
						return;
					}
				}
				buffers.push(chunk.slice(0));
				if(buffers.reduce((p,c)=>p+c.length,0)>flushThreshold){
					flush();
				}
			}else{
				flush();
			}
		}
	};
}

function soundThresholdAnalysis(chunk,from,length,threshold){
	for(var i=from;i<from+length;i++){
		var soundLevel = chunk[i];
		if(soundLevel<-threshold || soundLevel>threshold){
            return true;
        }
    }
    return false;
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

function voipV3(url,sampleRate,shouldSend){
	return recorder().then(r=>{
		play = mp3Nextplayer(sampleRate,250);
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
	},(e)=>{log(e);playDisconnectSound();onDisconnect();});
}

function connectToControl(){
	this.disabled = true;
	connectWebsocket('/control').then(ws=>{
		ws.setOnClose(()=>log('control close')).setOnMessage(data=>{
			data = JSON.parse(data);
			log('Connecting to room ' + data.room);
			ws.close();
			connectToVoip('/room/' + data.room,data.sampleRate,simpleThresholdAnalysisFunction,()=>this.disabled=false);
		}).send(JSON.stringify({sampleRate:audio.context().sampleRate}));
	})
}

document.getElementById('connectButton').addEventListener('click',connectToControl);

var globalSettings = {
	mute:false,
	threshold:0.03,
	briefSkipFactor:4,
	thoroughFactor:6,
	noComfortingNoise:false
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
	if(globalSettings.noComfortingNoise){
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
