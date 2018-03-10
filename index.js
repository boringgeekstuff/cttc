log=console.log;

var production = process.env.NODE_ENV === 'production';

var PORT = process.env.PORT || 8080;

var express = require('express');
var WebSocket = require("ws");
var WebSocketServer = WebSocket.Server;
var http = require("http");
var url = require('url');

var app = express();

app.use('/res',express.static('res'));

Object.entries({
    '/room/':'/room.html'
}).forEach(([url,file])=>{
    app.get(url,(req, res) => {
        if(production && req.get('X-Forwarded-Proto') !== 'https'){
            res.redirect(`https://${req.hostname}${req.url}`)
        }else{
            res.sendFile(__dirname + file);
        }
    });
});

var httpServer = http.createServer(app);

server = new WebSocketServer({ 
    noServer:true
});


var websocketHandlers = [
    [/\/room\/([0-9]+)/,roomHandler],
    [/control/,controlHandler]
];


httpServer.on('upgrade', (request, socket, head) => {
    var pathname = url.parse(request.url).pathname;

    if(!websocketHandlers.some(([regex,handler])=>{
        var match = pathname.match(regex);
        if(match){
            handler.call(null,request,socket,head,...match.slice(1));
            return true;
        }
    })){
        socket.destroy();
    }
});

var rooms = {};
var NOBODY_CONNECTED_TIMEOUT = 5000;

var clientsCounter = 0;

function roomHandler(request, socket, head, roomId){
    var clientId = ++clientsCounter;
    if(rooms[roomId]==true){
        socket.destroy();
    }else if(rooms[roomId]){
        server.handleUpgrade(request, socket, head, (ws) => {
            ws.on('error',log);
            if(rooms[roomId]==true || !rooms[roomId]){
                log(`Visitor ${clientId} missed host in ${roomId}`);
                ws.close();
            }else{
                log(`Visitor ${clientId} entering room ${roomId}`);
                rooms[roomId](ws);
            }
        });
    }else{
        var nobodyConnectedTimeout = setTimeout(()=>{
            log(`Host ${clientId} kicked from room ${roomId}`);
            delete rooms[roomId];
            socket.destroy();
        },NOBODY_CONNECTED_TIMEOUT);
        var visitorFound = false;
        socket.on('close',()=>{
            if(!visitorFound){
                clearTimeout(nobodyConnectedTimeout);
                log(`Host ${clientId} left room early ${roomId}`);
                delete rooms[roomId];
            }
        });
        log(`Host ${clientId} waiting in a room ${roomId}`);
        rooms[roomId] = function(ws2){
            socket.on('close',()=>{
                if(!visitorFound){
                    log(`Host ${clientId} left just as visitor was entering at ${roomId}`);
                    ws2.close();
                }
            });
            clearTimeout(nobodyConnectedTimeout);
            rooms[roomId] = true;
            server.handleUpgrade(request, socket, head, (ws) => {
                visitorFound = true;
                ws.on('error',(e)=>{
                    log(`Error with host ${clientId} in room ${roomId}`);
                    log(e);
                });
                if(ws2.readyState === WebSocket.OPEN){
                    log(`Users met in room ${roomId}, host was ${clientId}`);
                    ws.on('message',m=>ws2.send(m));
                    ws.on('close',()=>{
                        log(`Host ${clientId} leaving room ${roomId}`);
                        delete rooms[roomId];
                        ws2.close();
                    });
                    ws2.on('message',m=>ws.send(m));
                    ws2.on('close',()=>{
                        log(`Visitor leaving room ${roomId} hosted by ${clientId}`);
                        ws.close();
                    });
                }else{
                    log(`Visitor ${clientId} left already ${roomId}`);
                    delete rooms[roomId];
                    ws.close();
                    ws2.close();
                }
            });
        };
    }
}

var waitingUser = null;
var roomCounter = 1;
function controlHandler(request, socket, head){
    server.handleUpgrade(request, socket, head, (ws) => {
        ws.on('message',m=>{
            var data = JSON.parse(m);
            log('connected user, sample rate ' + data.sampleRate);
            if(waitingUser){
                var room = roomCounter++;
                ws.send(JSON.stringify({room:room,sampleRate:waitingUser.sampleRate}));
                ws.close();
                waitingUser.ws.send(JSON.stringify({room:room,sampleRate:data.sampleRate}));
                waitingUser.ws.close();
            }else{
                waitingUser = {
                    ws:ws,
                    sampleRate:data.sampleRate
                };
                ws.on('close',()=>{
                    waitingUser=null;
                })
            }
        });
    });
}


function createPerf(){
    var time = process.hrtime();
    var itemsProcessed = 0;
    return (items)=>{
        itemsProcessed+=items;
        var elapsed = process.hrtime(time);
        if(elapsed[0]>0){
            log('IPS ' + (itemsProcessed/(elapsed[0]+elapsed[1]/1000000000)));
            time = process.hrtime();
            itemsProcessed=0;
        }
    };
}

httpServer.listen(PORT,()=>log(`App up on http://localhost:${PORT} in ${production?'production':'dev'} mode`));
