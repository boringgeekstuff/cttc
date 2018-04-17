var magic = 1.61803398875;


var DEFAULT_THRESHOLD = 0.03;
var globalSettings = {
	mute:false,
	threshold:parseFloat(localStorage.getItem('threshold') || DEFAULT_THRESHOLD),
	briefSkipFactor:4,
	noComfortingNoise:false
};

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




document.getElementById('muteButton').addEventListener('click',function(){
	this.innerHTML = (globalSettings.mute = !globalSettings.mute)?'Включить микрофон':'Выключить микрофон';
});

document.getElementById('calibrateButton').addEventListener('click',function(){
	var status = document.getElementById('calibrationStatus');
	var countDown = 3;
	function doCountDown(){
		if(countDown>0){
			status.innerHTML = 'Калибровка фонового шума через ' + countDown;
			countDown--;
		}else{
			clearInterval(interval);
			status.innerHTML = 'Калибровка фонового шума';
			analyseMaxSoundLevel(4000).then(silenceMax=>{
				if(silenceMax==0){
					throw 'Зафиксирован нулевой уровень звука'
				}else{
					localStorage.setItem('threshold',silenceMax*magic);
					globalSettings.threshold = silenceMax;
					status.innerHTML = 'Калибровка успешна';
				}
			}).catch(e=>{
				log(e);
				status.innerHTML = 'Калибровка фонового шума не удалась';
			}).then($=>document.getElementById('calibrateButton').disabled = false);
		}
	}
	var interval = setInterval(doCountDown,1000);
	document.getElementById('calibrateButton').disabled = true;
	doCountDown();
});
document.getElementById('clearCalibration').addEventListener('click',function(){
	localStorage.setItem('threshold',DEFAULT_THRESHOLD);
	globalSettings.threshold = DEFAULT_THRESHOLD;
	document.getElementById('calibrationStatus').innerHTML = 'Калибровка сброшена';	
});