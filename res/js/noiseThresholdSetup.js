
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

