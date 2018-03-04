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
    '/room/:roomId':'/room.html',
    '/roomv3/:roomId':'/roomv3.html',
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

var rooms = {};
var roomsv3 = {};

httpServer.on('upgrade', (request, socket, head) => {
    var pathname = url.parse(request.url).pathname;

    var match = pathname.match(/\/room(v3)?\/([0-9]+)/);
    if(match){
        var roomId = match[2];
        if(match[1]){
            roomv3Hanlder(request, socket, head, roomId);
        }else{
            roomHandler(request, socket, head, roomId);
        }
    }else{
        socket.destroy();
    }
});

function roomHandler(request, socket, head,roomId){
    if(rooms[roomId]!=true){
        server.handleUpgrade(request, socket, head, (ws) => {
            if(rooms[roomId]===true){
                log('close socket: room taken');
                ws.close();
                return;
            }
            ws.on('error',log);
            if(rooms[roomId]){
                //var perf = createPerf();
                log('talk initiated');
                var user = rooms[roomId];
                user.on('message',(m)=>{
                    ws.send(m);
                });
                ws.on('message',(m)=>{
                    user.send(m);
                });
                user.on('close',()=>{
                    log('close socket');
                    ws.close();
                });
                ws.on('close',()=>{
                    log('close socket');
                    user.close();                    
                });
                rooms[roomId] = true;
            }else{
                log('Sitting in a room ' + roomId);
                rooms[roomId] = ws;
                ws.on('close',()=>{
                    log('leave room ' + roomId);
                    delete rooms[roomId];
                });
            }
        });
    }else{
        socket.destroy();
    }
}

var NOBODY_CONNECTED_TIMEOUT = 5000;

var clientsCounter = 0;

function roomv3Hanlder(request, socket, head, roomId){
    var clientId = ++clientsCounter;
    if(roomsv3[roomId]==true){
        socket.destroy();
    }else if(roomsv3[roomId]){
        server.handleUpgrade(request, socket, head, (ws) => {
            ws.on('error',log);
            if(roomsv3[roomId]==true || !roomsv3[roomId]){
                log(`Visitor ${clientId} missed host in ${roomId}`);
                ws.close();
            }else{
                log(`Visitor ${clientId} entering room ${roomId}`);
                roomsv3[roomId](ws);
            }
        });
    }else{
        var nobodyConnectedTimeout = setTimeout(()=>{
            log(`Host ${clientId} kicked from room ${roomId}`);
            delete roomsv3[roomId];
            socket.destroy();
        },NOBODY_CONNECTED_TIMEOUT);
        var visitorFound = false;
        socket.on('close',()=>{
            if(!visitorFound){
                clearTimeout(nobodyConnectedTimeout);
                log(`Host ${clientId} left room early ${roomId}`);
                delete roomsv3[roomId];
            }
        });
        log(`Host ${clientId} waiting in a room ${roomId}`);
        roomsv3[roomId] = function(ws2){
            socket.on('close',()=>{
                if(!visitorFound){
                    log(`Host ${clientId} left just as visitor was entering at ${roomId}`);
                    ws2.close();
                }
            });
            clearTimeout(nobodyConnectedTimeout);
            roomsv3[roomId] = true;
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
                        delete roomsv3[roomId];
                        ws2.close();
                    });
                    ws2.on('message',m=>ws.send(m));
                    ws2.on('close',()=>{
                        log(`Visitor leaving room ${roomId} hosted by ${clientId}`);
                        ws.close();
                    });
                }else{
                    log(`Visitor ${clientId} left already ${roomId}`);
                    delete roomsv3[roomId];
                    ws.close();
                    ws2.close();
                }
            });
        };
    }
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
