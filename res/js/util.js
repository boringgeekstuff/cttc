log=console.log;

Args = {
	swap : (fn)=>(a,b,...rest)=>fn(b,a,...rest)
};

Function.nope = ()=>{};

Function.return = v=>()=>v;

Function.lazy = function(factory){
    var resolver = ()=>(resolver=Function.return(factory()))();
    return ()=>resolver();
};

Array.prototype.callEach = function(self,...args){
    this.applyEach(self,args);
};

Array.prototype.applyEach = function(self,args){
    for(var i=0;i<this.length;i++){
        this[i].apply(self,args);
    }
    return this;
};

function createExpandingObject(factory,o={}){
    return new Proxy(o,{
        get:(t,p)=>(t[p]||(t[p]=factory(p)))
    });
}


function EventEmitter(){
    var ee = this;
    var handlers = createExpandingObject(_=>[]);
    ee.on = function(event,handler){
        handlers[event].push(handler);
        return ee;
    };
    ee.off = function(event,handler){
        var index = handlers[event].indexOf(handler);
        if(index!==-1){
            handlers[event].splice(index,1);
        }
        return ee;
    };
    ee.once = function(event,handler){
        handler = (h=>(e,payload)=>{
            ee.off(event,handler);
            h(e,payload);
        })(handler);
        ee.on(event,handler);
        return ee;
    };
    ee.emit = function(event,payload){
        handlers[event].slice(0).callEach(ee,payload,event);
        return ee;
    };
}

var EE = EventEmitter;

EE.onEvery = function(event,fn,ees){
	ees.forEach(e=>e.on(event,fn));
};

EE.onceEvery = function(event,fn,ees){
	ees.forEach(e=>e.once(event,fn));
};

EE.emitEvery = function(event,payload,ees){
	ees.forEach(e=>e.emit(event,payload));
};

EE.offEvery = function(event,fn,ees){
	ees.forEach(e=>e.off(event,fn));
};

EE.broadcast = function(event,ees){
	function broadcast(data){
		EE.offEvery(event,broadcast,ees);
		EE.emitEvery(event,data,ees);
	}
	EE.onceEvery(event,broadcast,ees);
};

EventEmitter.prototype.emitter = function(event){
	return (payload)=>this.emit(event,payload);
};

function Intermitter(ee,interceptors){
    EventEmitter.apply(this);
    Object.entries(interceptors).forEach(([event,fn])=>{
        this.on(event,(data)=>fn(data)?ee.emit(event,data):'');
    });
}

Intermitter.prototype=EventEmitter.prototype;

var Pipe = {
	syncFn : function(fn){
		return (d,cb)=>cb(fn(d));
	},
	delayFirst : function(time){
		var first = true;
		return (d,cb)=>first?(first=(setTimeout(()=>cb(d),time) && false)):cb(d);
	}
};


Promise.delay = (delay)=>new Promise(r=>setTimeout(r, delay));

Promise.callDelay = (delay,fn)=>Promise.delay(delay).then(fn);

function float32Concat(iterable){
	var result = new Float32Array(iterable.reduce((a,b)=>a+b.length,0));
	iterable.reduce((o,a)=>{result.set(a,o);return o+a.length},0);
	return result;
}

function createLogReturnHandler(result){
    return function(){
        log.apply(null,arguments)
        return result;
    };
}