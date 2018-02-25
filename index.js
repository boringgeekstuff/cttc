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

var httpServer = http.createServer(app);

server = new WebSocketServer({ 
    noServer:true
});

var rooms = {};

httpServer.on('upgrade', (request, socket, head) => {
    var pathname = url.parse(request.url).pathname;

    var match = pathname.match(/\/room\/([0-9]+)/);
    var roomId = match[1];
    if(match && rooms[roomId]!=true){
        server.handleUpgrade(request, socket, head, (ws) => {
            if(rooms[roomId]===true){
                ws.close();
            }
            ws.on('error',log);
            if(rooms[roomId]){
                var perf = createPerf();
                var user = rooms[roomId];
                user.on('message',(m)=>{
                    ws.send(m);
                });
                ws.on('message',(m)=>{
                    user.send(m);
                });
                user.on('close',()=>{
                    ws.close();
                });
                ws.on('close',()=>{
                    user.close();                    
                });
                rooms[roomId] = true;
            }else{
                rooms[roomId] = ws;
                ws.on('close',()=>{
                    delete rooms[roomId];
                });
            }
        });
    }else{
        socket.destroy();
    }
});

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