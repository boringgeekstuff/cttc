function echoTest(){
	audio.record().then(r=>pipeline(r,[audioTools.getFirstChannel,audioTools.toAudioBuffer(),Pipe.delayFirst(2000)],audio.play()))
}


function recordPlayTest(){
	record().then(stop=>setTimeout(()=>stop().then(playBuffers),4000));
}

function record(){
	return audio.record().then(r=>{
		var toArray = audio.toArray();
		pipeline(r,[audioTools.getFirstChannel,audioTools.copyFloat32],toArray);
		return ()=>{
			r.emit('shutdown');
			return new Promise((resolve)=>{
				toArray.on('drain',resolve);
			});
		}
	});	
}

function playBuffers(buffers){
	pipeline(audio.fromArray(buffers,true),[audioTools.toAudioBuffer()],audio.play());
}

function analyseNoise(){
	return record().then(Promise.callDelay.bind(null,4000)).then(buffers=>{
		buffers = float32Concat(buffers);
		buffers = buffers.map(f=>Math.abs(f));
		return [analysis.minmidmax(buffers.slice(buffers.length/4,buffers.length*3/4)),analysis.minmidmax(buffers)];
	});
}

function recordNoiseDropping(noiseLevel){
	return audio.record().then(r=>{
		var toArray = audio.toArray();
		var noiseAnalysis = analysis.thresholdAnalysis(noiseLevel);
		pipeline(r,[audioTools.getFirstChannel,audioTools.copyFloat32,(c,cb)=>cb((c==null||noiseAnalysis(c))?c:[])],toArray);
		return ()=>{
			r.emit('shutdown');
			return new Promise((resolve)=>{
				toArray.on('drain',resolve);
			});
		}
	});	
}


function recordNoiseDroppingPlayTest(noiseLevel){
	recordNoiseDropping(noiseLevel).then(Promise.callDelay.bind(null,10000)).then(playBuffers);
}

function setUpVOIP(noiseLevel){
	var noiseAnalysis = analysis.thresholdAnalysis(noiseLevel);
	Promise.all([
		web.wconnect(location.pathname),
		audio.record()
	]).then(([[inEE,outEE],r])=>{
		pipeline(r,[audioTools.getFirstChannel,audioTools.copyFloat32,(c,cb)=>cb(noiseAnalysis(c)?c:[])],new Intermitter(outEE,{data:(a)=>a.length>0}));
		pipeline(inEE,[audioTools.toFloat32, audioTools.toAudioBuffer()],audio.play());
	});
}

var noiseLevel = 0.006;

document.getElementById('noisetest').addEventListener('click',()=>{
	var magic = 1.61803398875;
	alert('Оценка фонового шума, после нажатия OK в течении 4 секунд постарайтесь поддерживать тишину');
	analyseNoise().then(([middleSilence,fullSilence])=>{
		alert('Оценка уровня звука при разговоре, после нажатия OK в течении 4 секунд скажите несколько слов обычным голосом');
		return analyseNoise().then(([middleVoice,fullVoice])=>{
			if(middleSilence.max===0 || fullSilence.max===0||fullVoice.max===0||middleVoice.max===0){
				alert('Зафиксирован нулевой уровень звука, возможно микрофон не подключен или работает некорректно');
			}else if(middleSilence.max*magic*magic>fullVoice.max){
				alert('Разница между тишиной и голосом слишком маленькая, возможно тест проведенн некорректно')
			}else{
				alert('Похоже, все хорошо. Настройки фонового шума обновлены');
				log(noiseLevel=middleSilence.max*magic);
			}
		});
	})
});
document.getElementById('connectButton').addEventListener('click',()=>{
	setUpVOIP(noiseLevel);
});