/*

cttc extended logging points

playsound queue (abstract mechanism?) logger
ws send load logger
sound level analysis load logger
server-side buffers per second logger

cttc improvements

ws reconnect(attempts-left-based)
server-side overhaul
comforting noise

*/

var magic = 1.61803398875;
var audio = {
	context: new AudioContext(),
	sampleRate : 44100,
	channels : 1,
	bufferSize : 4096
};

Function.nope = ()=>{};

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

function recorder({context,sampleRate,channels,bufferSize}=audio){
	return navigator.mediaDevices.getUserMedia({audio:{
			autoGainControl:false,
			echoCancellation:true,
			noiseSuppression:true,
			sampleRate:sampleRate,
			channelCount:channels
	}}).then((stream)=>{
        var source = context.createMediaStreamSource(stream);
        var processor = context.createScriptProcessor(bufferSize, channels, channels);
        return {
        	start:function(){
        		source.connect(processor);
        		processor.connect(context.destination);
        		return this;
        	},
        	replaceConsumer:function(consumer){
        		processor.onaudioprocess = (consumer)?function(event){
		            consumer(event.inputBuffer.getChannelData(0));
		        }:null;
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

function asBufferSource(buffer,{context,sampleRate,channels}=audio){
    buffer = new Float32Array(buffer);
    var source = context.createBufferSource(channels, buffer.length, sampleRate);
    var abuffer = context.createBuffer(channels, buffer.length, sampleRate);
    for(var i=0;i<channels;i++){
        abuffer.copyToChannel(buffer,i,0);
    }
	source.buffer = abuffer;
	return source;
}

function nextPlayer({context,sampleRate,channels}=audio){
    var currentQueue = 0;
    var queue = [];
    var rawQueue = [];
    var currentPlaying = 0;
    function playSource(source){
    	source.onended = ()=>{
    		source.disconnect(context.destination);
    		next();
    	};
    	source.connect(context.destination);
    	source.start(0);
    }
    function next(){
        if(currentQueue-=currentPlaying>0){
            if(queue.length>0){
                var [source,length] = queue.shift();
                currentPlaying = length;
                playSource(source);
            }else{
                currentPlaying = 1;
                playSource(asBufferSource(rawQueue.shift()));
            }
        }else{
            currentPlaying=0;
        }
    }
    return (buffer)=>{
        currentQueue++;
        if(currentPlaying==0){
            currentPlaying = 1;
            playSource(asBufferSource(buffer),next);
        }else{
            rawQueue.push(buffer);
            while(queue.length<2 && rawQueue.length>0){
                queue.push([asBufferSource(rawQueue.shift()),1]);
            }
            var appropriateBufferSize = Math.floor(currentQueue.length/2);
            if(appropriateBufferSize>0 && rawQueue.length>=appropriateBufferSize){
                console.log(currentQueue.length,queue.length,rawQueue.length);
                queue.push([asBufferSource(float32Concat(rawQueue.splice(0,appropriateBufferSize))),appropriateBufferSize]);
            }
        }
    };
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

function voipV3(url,isSilence){
	var track = createStatTracker(document.getElementById('stats'));
	return recorder().then(r=>{
		var play = nextPlayer();
		var connected = false;
		var noise;
		function connect(){
			r.replaceConsumer(null);
			return connectWebsocket(url).then((ws)=>{
				window.onbeforeunload = function(e) {
					ws.close();
				}
				noise = comfortingNoise()
				r.replaceConsumer((buffer)=>{
					if(!globalSettings.mute && !isSilence(buffer)){
						track('send');
						ws.send(buffer);
					}else{
						track('silence frame');
					}
				});
				ws.setOnMessage(e=>{
					track('receive');
					play(e);
				}).setOnClose(()=>{
					if(noise){
						noise();
					}
					log('Attempting reconnect');
					connect();
				});
			},()=>{
				new Audio('/res/audio/disconnected.wav').play();
				r.stop();
				if(!connected){
					throw 'Connection rejected';
				}
			});
		}
		
		return connect().then(()=>{
			connected = true;
			new Audio('/res/audio/connected.wav').play();
			r.start();
		},log);
	});
}

var globalSettings = {
	mute:false,
	threshold:0.006,
	skipFactor:4
};

document.getElementById('connectButton').addEventListener('click',()=>{
	var {threshold,skipFactor} = globalSettings;
	voipV3(location.pathname,(chunk)=>{
		for(var i=0;i<(chunk.length>>skipFactor);i++){
        	var soundLevel = chunk[i<<skipFactor];
            if(soundLevel<-threshold || soundLevel>threshold){
                return false;
            }
        }
        return true;
	});
});

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

function comfortingNoise(loudness=globalSettings.threshold*Math.pow(magic,-4)){
    var context = new AudioContext();
    var node = context.createBufferSource();
    var alignment = 4096;
    var buffer = context.createBuffer(1, Math.floor(context.sampleRate/alignment)*alignment, context.sampleRate)
    data = buffer.getChannelData(0);
    for (var i = 0; i < data.length; i++) {
        data[i] = Math.random()*loudness;
    }    
    node.buffer = buffer;
    node.loop = true;
    node.connect(context.destination);
    node.start(0);
    return ()=>{
    	node.loop = false;
    	node.disconnect();
    };
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

document.getElementById('muteButton').addEventListener('click',function(){
	this.innerHTML = (globalSettings.mute = !globalSettings.mute)?'Включить микрофон':'Выключить микрофон';
});

function createStatTracker(table){
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