log=console.log;

var PORT = process.env.PORT || 8080;

var express = require('express');
var WebSocketServer = require("ws").Server;
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
    log(match[0],match[1],match[2]);
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

function roomv3Hanlder(request, socket, head, roomId){
    if(roomsv3[roomId]==true){
        socket.destroy();
    }else{
        server.handleUpgrade(request, socket, head, (ws) => {
            if(roomsv3[roomId]==true){
                ws.close();
            }else if(roomsv3[roomId]){
                roomsv3[roomId](ws);
            }else{
                roomsv3[roomId] = function(ws2){
                    var wsOnMessage = (m)=>{
                        ws2.send(m);
                    };
                    ws.on('message',wsOnMessage);
                    ws.on('close',()=>{
                        ws2.close();
                    });
                    var ws2OnMessage = (m)=>{
                        ws.send(m);
                    };
                    ws2.on('message',ws2OnMessage);
                    ws2.on('close',()=>{
                        ws.close();
                    });
                    roomsv3[roomId] = true;
                };
                ws.on('close',()=>{
                    delete roomsv3[roomId];
                });
                log('Waiting in a room ' + roomId);
            }
        });
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