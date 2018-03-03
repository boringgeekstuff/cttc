log=console.log;

var PORT = process.env.PORT || 8080;

var express = require('express');
var WebSocket = require("ws");
var WebSocketServer = WebSocket.Server;
var http = require("http");
var url = require('url');

var app = express();

app.use('/res',express.static('res'));

app.get('/room/:roomId',(req,res)=>{
    res.sendFile(__dirname + '/room.html');
});
app.get('/roomv3/:roomId',(req,res)=>{
    res.sendFile(__dirname + '/roomv3.html');
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

function roomv3Hanlder(request, socket, head, roomId){
    if(roomsv3[roomId]==true){
        socket.destroy();
    }else if(roomsv3[roomId]){
        server.handleUpgrade(request, socket, head, (ws) => {
            ws.on('error',log);
            if(roomsv3[roomId]==true || !roomsv3[roomId]){
                ws.close();
            }else{
                log('Visitor entering room ' + roomId);
                roomsv3[roomId](ws);
            }
        });
    }else{
        var nobodyConnectedTimeout = setTimeout(()=>{
            log('Host kicked from room ' + roomId);
            delete roomsv3[roomId];
            socket.destroy();
        },NOBODY_CONNECTED_TIMEOUT);
        socket.on('close',()=>{
            clearTimeout(nobodyConnectedTimeout);
            log('Host left room early ' + roomId);
            socket.destroy();
            delete roomsv3[roomId];
        });
        log('Host waiting in a room ' + roomId);
        roomsv3[roomId] = function(ws2){
            clearTimeout(nobodyConnectedTimeout);
            roomsv3[roomId] = true;
            server.handleUpgrade(request, socket, head, (ws) => {
                ws.on('error',log);
                if(ws2.readyState === WebSocket.OPEN){
                    log('Users met ' + roomId);
                    ws.on('message',m=>ws2.send(m));
                    ws.on('close',()=>{
                        log('Host leaving room ' + roomId);
                        delete roomsv3[roomId];
                        ws2.close();
                    });
                    ws2.on('message',m=>ws.send(m));
                    ws2.on('close',()=>{
                        log('Visitor leaving room ' + roomId)
                        ws.close();
                    });
                }else{
                    log('Host left already ' + roomId);
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

httpServer.listen(PORT,()=>log('App up on http://localhost:' + PORT));