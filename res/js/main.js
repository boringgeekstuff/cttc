log=console.log;
// cut to the chase

var audio = {
	context: new AudioContext(),
	settings : {
		sampleRate : 44100,
		channels : 1,
		bufferSize : 2048
	},
	record : ({sampleRate,channels,bufferSize}=audio.settings)=>navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,sampleRate:sampleRate}}).then((stream)=>{
        var emitter = new EventEmitter();
        var source = audio.context.createMediaStreamSource(stream);
        var processor = audio.context.createScriptProcessor(bufferSize, channels, channels);
        source.connect(processor);
        processor.connect(audio.context.destination);        
        processor.onaudioprocess = function(event){
            emitter.emit('data',event);
        };
        emitter.on('shutdown',()=>{
            source.disconnect(processor);
            processor.disconnect(audio.context.destination);
            stream.getTracks().forEach(t=>t.stop());
        });
        return emitter;
    }),
	play : function({sampleRate,channels}=audio.settings){
        var emitter = new EventEmitter();
        var queue = [];
        function playBuffer(buffer){
        	// TODO:drain event
            var source = audio.context.createBufferSource(channels, buffer.length, sampleRate);
            source.buffer = buffer;
            source.onended = ()=>{
                source.disconnect(audio.context.destination);
                queue.shift();
                if(queue.length>0){
                    var nextSource = queue[0];
                    nextSource.connect(audio.context.destination);
                    nextSource.start(0);
                }
            };
            queue.push(source);
            if(queue.length===1){
                source.connect(audio.context.destination);
                source.start(0);
            }
        }
        emitter.on('data',playBuffer);
        emitter.on('shutdown',()=>emitter.off('data',playBuffer));
        return emitter;
    },
	fromArray : (buffers,start=false)=>{
		var emitter = new EventEmitter();
		emitter.once('start',()=>{
			buffers.forEach(d=>emitter.emit('data',d));
		});
		if(start){
			setTimeout(emitter.emitter('start'),0);
		}
		return emitter;
	},//drain event
	toArray : ()=>{
		var emitter = new EventEmitter();
		var buffers = [];
		function processData(d){
			if(d==null){
				emitter.emit('drain',buffers);
				emitter.off('data',processData);
			}else if(d.length>0){
				buffers.push(d);
			}
		}
		emitter.on('data',processData);
		return emitter;
	}//drain event
};


var audioTools = {
	getFirstChannel : (e,cb)=>cb((e!=null)?e.inputBuffer.getChannelData(0):e),
	toFloat32:(arrayBuffer,cb)=>cb(new Float32Array(arrayBuffer)),
	copyFloat32:(a,cb)=>cb((a!=null)?a.slice(0,a.length):a),
	toAudioBuffer : (channels=audio.settings.channels,sampleRate=audio.settings.sampleRate)=>(buffer,cb)=>{
        var abuffer=audio.context.createBuffer(channels, buffer.length, sampleRate);
        for(var i=0;i<channels;i++){
	        abuffer.copyToChannel(buffer,i,0);
	    }
        cb(abuffer);
    }
};

var analysis = {
	thresholdAnalysis : (threshold)=>(chunk)=>{
        for(var i=0;i<chunk.length;i++){
            if(chunk[i]<-threshold || chunk[i]>threshold){
                return true;
            }
        }
        return false;
    },
	minmidmax : (arr)=>{
		arr.sort((a,b)=>a-b);
		return {
			min:arr[0],
			max:arr[arr.length-1],
			mid:(arr[0]+arr[arr.length-1])/2,
			median:(arr[Math.floor((arr.length-1)/2)]+arr[Math.floor((arr.length-1)/2)+1])/2,
			avg:arr.reduce((a,b)=>a+b,0)/arr.length,
			avgsqr:Math.sqrt(arr.reduce((a,b)=>a+b*b,0)/arr.length),
			avggeom:((subarray)=>Math.pow(subarray.reduce((a,b)=>a*b,1),1/subarray.length))(arr.slice(arr.findIndex(n=>n>0)))
		};
	},
	max : function(buffers){
		return buffers.reduce((max,chunk)=>[].reduce.call(chunk,(a,b)=>Math.max(a,b),max),-1);
	}
};

var web = {
	wconnect:(url)=>new Promise((resolve,reject)=>{
		var ws = new WebSocket('ws'+window.location.origin.substring(4) + url);
		ws.binaryType = 'arraybuffer';
		ws.onerror = reject;
		ws.onopen = ()=>{
			var inEE = new EventEmitter();
			var outEE = new EventEmitter();
			function sendData(data){
				ws.send(data);
			}
			ws.onerror = null;
			ws.onclose = ()=>{
				outEE.off('data', sendData)
				EventEmitter.emitEvery('shutdown', undefined, [inEE, outEE]);
			};
			outEE.on('data', sendData);
			EventEmitter.onceEvery('shutdown', ()=>{
				ws.close();
			}, [outEE, inEE]);
			ws.onmessage = (event)=>{
				inEE.emit('data', event.data);
			};
			resolve([inEE,outEE]);
		};
	})
};

function pipeline(source, processors, destination){
	source.on('data',Array.from(processors).reverse().reduce(sequential.swapped,destination.emitter('data')));
}

//new EventEmitter().on('data',data=>data.length?outEE.emit('data',data):'');

function sequential(fn,cb){
	var processing = false;
	var queue = [];
	var wrappedcb = (result)=>{
		cb(result);
		if(queue.length){
			fn(queue.shift(),wrappedcb);
		}else{
			processing = false;
		}
	};
	return (data)=>{
		if(!processing){
			processing = true;
			fn(data,wrappedcb);
		}else{
			queue.push(data);
		}
	};
}

sequential.swapped = Args.swap(sequential);

// utilitary 

// mock/test
var logEE = new EventEmitter();
logEE.on('data',log);
var plain = (d,cb)=>cb(d);
var chooseDelay = (d,cb)=>(d==1)?cb(d):setTimeout(cb.bind(0,d),1000);
var ee = new EE();
