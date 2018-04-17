
function SimpleMP3Player(initialBuffers, mimeCodec){
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
