const Server = require("ws").Server;
const {readFileSync, writeFileSync} = require("fs");
const { app } = require("./client");

let log = {users:[]};
try{
    log = JSON.parse(readFileSync(__dirname + "/userdata.json", "utf8"));
}catch(e)
{
    console.log("Couldn't read user data because:\n"+e+"\nProceeding anyway!");
}

let shopdata = {};
try
{
    shopdata = JSON.parse(readFileSync(__dirname + "/shopdata.json", "utf8"));
}catch(e)
{
    console.log("Couldn't read shop data because:\n" + e + "\n Proceeding anyway!");
}

let config = {
    server_address: "localhost:5050",
    client_address: "localhost:42069",
    kill_reward: 50,
    newbie_money: 100,
    simulated_latency: 0,
    max_lobby_capacity: 20,
    map_index_function: "Math.floor( Math.random() * mapCount )",
    max_lobby_count: 1024,
    allow_private_lobby: true,
    delete_empty_private_lobby: true,
    delete_empty_public_lobby: false,
    server_code_injection: false
};


try
{
    config = JSON.parse(readFileSync(__dirname + "/properties.json"));
}catch(e)
{
    console.log("Couldn't read properties.json because:\n" + e + "\n Proceeding anyway! [with debug configurations]");
    saveConfig();
}


const hostname = config.server_address.split(':')[0];
const port = config.server_address.split(':')[1];

const wss = new Server({port:port, host:hostname});
console.log(`Server running on - ${hostname}:${port}`);

app.listen(config.client_address.split(':')[1], config.client_address.split(':')[0], ()=>{
    console.log(`Client-side server running on - http://${config.client_address}/home.html`);
});


let simulatedLatency = config.simulated_latency ?? 0; // in ms

function GetCode()
{
    const validChars = "QWERTYUIOPASDFGHJKLZXCVBNM";
    let id = "";

    for(let i = 0; i < 5; i ++)
    {
        id += validChars[Math.floor(Math.random() * validChars.length)]
    }

    return id;
}

function GetLobbyFromCode(code)
{
    for(let i = 0; i < lobbies.length; i ++)
    {
        if(lobbies[i].code == code) return lobbies[i];
    }

    return null;
}

function CheckLobbyExistance(code)
{
    for(let i = 0; i < lobbies.length; i ++)
    {
        if(lobbies[i].code == code) return true;
    }

    return false;
}

function JoinLobby(code, socket, username, id)
{
    for(let i = 0; i < lobbies.length; i ++)
    {
        if(lobbies[i].code != code) continue;
        
        lobbies[i].AddUser(socket, username);
        return;
    }
    
    socket.send(JSON.stringify({
        type: "join",
        status: false,
        reason: "invalid code"
    }));
}

function RemoveEmptyLobbies(private = false)
{
    let rem = [];

    for(let i = 0; i < lobbies.length; i ++)
    {
        if(lobbies[i].sockets.length == 0)
        {
            if(private == !lobbies[i].public)
                rem.push(i);
        }
    }

    for(let i = 0; i < rem.length; i ++)
    {
        lobbies.splice(rem[i] - i, 1);
    }
}

class Lobby
{
    constructor()
    {
        this.maxPlayers = 3;
        this.sockets = [];
        this.code = GetCode();
        this.name = this.code;
        this.public = true;
        try
        {
            this.mapIndex = eval(config.map_index_function) ?? Math.floor(Math.random() * mapCount);
        }
        catch (e)
        {
            console.log("\n  Woops! It seems there was an error evaluating 'map_index_function' property!\n  Nerdy error : " + e + "\n  falling back to default function!\n");
            this.mapIndex = IntRandom(0, mapCount);
        }
    }

    AddUser(socket, username, id)
    {
        if(this.sockets.length >= this.maxPlayers)
        {
            socket.send(JSON.stringify({
                type: "join",
                status: false,
                reason: "full"
            }));
        }

        socket.send(JSON.stringify({
            type: "join",
            status: true,
            username: username,
            mapIndex: this.mapIndex
        }));

        socket.SID = id;
        socket.username = username;
        socket.lobby = this;

        console.log(username + " joined.");
        this.sockets.push(socket);
    }

    RemoveUser(socket)
    {
        for(let i = 0; i < this.sockets.length; i ++)
        {
            if(this.sockets[i].SID == socket.SID)
            {
                this.sockets.splice(i, 1);
                return;
            }
        }
    }

    Broadcast(data)
    {
        const src = JSON.stringify(data);

        for(let i = 0; i < this.sockets.length; i ++)
        {
            this.sockets[i].send(src);
        }
    }

    Disconnect(socket)
    {
        for(let i = 0; i < this.sockets.length; i ++)
        {
            if(socket.SID != this.sockets[i].SID) continue;

            this.Broadcast({
                type: "disconnect",
                ID: socket.username
            });

            this.RemoveUser(socket);
        }
    }
}

function ValidateJoinedSocket(socket)
{
    if(!socket.lobby)
    {
        console.log(`User <${socket.username}> not connected to a lobby!`);
        return false;
    }

    return true;
}

function GetPublicLobbyList()
{
    let lobbyList = [];

    for(let i = 0; i < lobbies.length; i ++)
    {
        if(lobbies[i].public && lobbies[i].sockets.length < lobbies[i].maxPlayers)
        {
            lobbyList.push({
                name: lobbies[i].name,
                maxPlayers: lobbies[i].maxPlayers,
                code: lobbies[i].code,
                playerCount: lobbies[i].sockets.length
            });
        }
    }

    return lobbyList;
}

const lobbies = [];
const mapCount = 2;

setInterval(()=>{
    if(config.delete_empty_private_lobby) RemoveEmptyLobbies(true);
    if(config.delete_empty_public_lobby)  RemoveEmptyLobbies(false);
}, 1000);


wss.on("connection", socket=>{
    socket.SID = "UNKNOWN";

    socket.on("message", msg_=>setTimeout((msg)=>{
        let data = {};
        try{
            data = JSON.parse(msg);
        }
        catch(e)
        {
            console.log("JSON Error: " + e);
            return;
        }
        
        if(data.type == "ping")
        {
            socket.send(JSON.stringify(data));
        }
        else if(data.type == "validate session")
        {
            let username = GetSessionUsername(data.session);
            if(username == false)
            {
                socket.send(JSON.stringify({
                    type: "validate session",
                    status: false
                }));
            }
            else
            {
                socket.send(JSON.stringify({
                    type: "validate session",
                    status: true,
                    username: username
                }));
            }
        }
        else if(data.type == "join")
        {
            let username = GetSessionUsername(data.ID);

            if(username == false)
            {
                socket.send(JSON.stringify({
                    type: "join",
                    status: false,
                    reason: "invalid session"
                }));

                console.log("[Join Lobby] kicked for invalid session.");
            }
            else
            {
                JoinLobby(data.code, socket, username, data.ID);
            }
        }
        else if(data.type == "find lobby")
        {
            const lobby = GetLobbyFromCode(data.code);

            if(lobby == null)
            {
                socket.send(JSON.stringify({
                    type: "find lobby",
                    status: false,
                    reason: "invalid code"
                }));
            }
            else if(lobby.sockets.length >= lobby.maxPlayers)
            {
                socket.send(JSON.stringify({
                    type: "find lobby",
                    status: false,
                    reason: "full"
                }));
            }
            else
            {
                socket.send(JSON.stringify({
                    type: "find lobby",
                    status: true,
                    code: data.code
                }));
            }
        }
        else if(data.type == "list lobby")
        {
            socket.send(JSON.stringify({
                type: "list lobby",
                lobbies: GetPublicLobbyList()
            }));
        }
        else if(data.type == "create lobby")
        {
            if(lobbies.length >= config.max_lobby_capacity)
            {
                socket.send(JSON.stringify({
                    type: "create lobby",
                    status: false,
                    reason: "Maximum lobby limit reached: " + config.max_lobby_capacity
                }));
                return;
            }
            else if(!data.public && config.allow_private_lobby)
            {
                socket.send(JSON.stringify({
                    type: "create lobby",
                    status: false,
                    reason: "Creation of private lobbies is not allowed"
                }));
                return;
            }

            const lobby = new Lobby();
            lobby.maxPlayers = Math.min(data.maxPlayers, config.max_lobby_capacity);
            lobby.name = data.name;
            lobby.public = data.public;
            lobbies.push(lobby);

            socket.send(JSON.stringify({
                type: "create lobby",
                code: lobby.code,
                status: true
            }));
        }
        else if(data.type == "chat" && data.message.length != 0)
        {
            if(!ValidateJoinedSocket(socket)) return;

            if(data.message[0] == "/")
            {
                execCommand(socket, data.message.substr(1));
                return;
            }

            socket.lobby.Broadcast({
                type : "message",
                from: data.username,
                message: data.message
            });

            console.log(`<${data.username}> ${data.message}`);
        }
        else if(data.type == "global")
        {
            if(!ValidateJoinedSocket(socket)) return;

            socket.lobby.Broadcast({
                type: "global",
                data: data.data
            });
        }
        else if(data.type == "create particle")
        {
            if(!ValidateJoinedSocket(socket)) return;

            socket.lobby.Broadcast({
                type: "create particle",
                particle: data.particle,
                data: data.data,
            });
        }
        else if(data.type == "damage")
        {
            sendDamagePacket(socket.username, data.user, data.damage, data.knockback);
        }
        else if(data.type == "killed" && socket.username != data.killer)
        {
            sendKilledPacket(data.killer);
            addMoney(data.killer, config.kill_reward);
        }
        else if(data.type == "account.create")
        {
            user_signup(data.username, data.password, socket);
        }
        else if(data.type == "account.login")
        {
            user_login(data.username, data.password, socket);
        }
        else if(data.type == "get data")
        {
            let username = GetSessionUsername(data.session);

            if(username == false)
            {
                socket.send(JSON.stringify({
                    type: "get data",
                    status: false,
                    reason: "invalid session"
                }));

                console.log("[Get Data] kicked for invalid session.");
            }
            else
            {
                socket.send(JSON.stringify({
                    type: "get data",
                    status: true,
                    data: GetUserData(username)
                }));
            }
        }
        else if(data.type == "get shop")
        {
            socket.send(JSON.stringify({
                type: "get shop",
                data: shopdata
            }));
        }
        else if(data.type == "buy item")
        {
            const item = GetItem(data.itemID);

            // Search for the user
            for(let i = 0; i < log["users"].length; i ++)
            {
                if(log["users"][i].session != data.session) continue;

                if(log["users"][i].data.money < item.price) return;

                // Check if the item is already bought
                for(let j = 0; j < log["users"][i].data.items.length; j ++)
                {
                    if(log["users"][i].data.items[j].ID != item.ID) continue;

                    if(item.rebuy)
                    {
                        log["users"][i].data.items[j].amount ++;
                        log["users"][i].data.money -= item.price;

                        saveLog();
                        socket.send(JSON.stringify({
                            type: "buy item",
                            status: true,
                            data: log["users"][i].data
                        }));
                    }
                    else
                    {
                        socket.send(JSON.stringify({
                            type: "buy item",
                            status: false,
                            reason: "This item is already bought!"
                        }));
                    }

                    return;
                }
                    
                // Buy the "new" item
                log["users"][i].data.items.push({
                    ID: item.ID,
                    amount: 1,
                    equipped: false,
                });

                log["users"][i].data.money -= item.price;
                saveLog();

                socket.send(JSON.stringify({
                    type: "buy item",
                    status: true,
                    data: log["users"][i].data
                }));

                break;
            }
        }
        else if(data.type == "equip item")
        {
            let user = null;

            for(let i = 0; i < log["users"].length; i ++)
            {
                if(log["users"][i].session != data.session) continue;
                user = log["users"][i];
            }

            if(!user)
            {
                socket.send(JSON.stringify({
                    type: "equip item",
                    status: false,
                    reason: "Invalid session, please login again."
                }));
                return;
            }

            user.data.inventory[data.itemID.split('.')[0]] = data.itemID;
            saveLog();

            socket.send(JSON.stringify({
                type: "equip item",
                status: true,
                itemID: data.itemID
            }));
        }
        else if(data.type == "unequip item")
        {
            let user = null;

            for(let i = 0; i < log["users"].length; i ++)
            {
                if(log["users"][i].session != data.session) continue;
                user = log["users"][i];
            }

            if(!user)
            {
                socket.send(JSON.stringify({
                    type: "unequip item",
                    status: false,
                    reason: "Invalid session, please login again."
                }));
                return;
            }

            user.data.inventory[data.itemType] = null;
            saveLog();

            socket.send(JSON.stringify({
                type: "unequip item",
                status: true,
                itemType: data.itemType
            }));
        }
        else if(data.type == "set amount")
        {
            if(!ValidateJoinedSocket(socket)) return;

            const userdata = GetUserData(socket.username);

            if(!userdata) return;

            for(let i = 0; i < userdata.items.length; i ++)
            {
                if(userdata.items[i].ID != data.itemID) continue;

                userdata.items[i].amount = data.amount;
                saveLog();
                break;
            }
        }
    }, simulatedLatency, msg_));

    socket.on("close", ()=>
    {
        if(!socket.username) return;

        console.log(socket.username + " disconnected.");
        socket.lobby.Disconnect(socket);
    });
});

wss.broadcast = (msg)=>
{
    const str = JSON.stringify(msg);
    wss.clients.forEach(client=>{
        client.send(str);
    });
}

function execCommand(socket, command)
{
    console.log(`${socket.username} executed "${command}"`);

    const attributes = command.split(" ");

    if(attributes[0] == "s")
    {
        if(!config.server_code_injection)
        {
            socket.send(JSON.stringify(
                {
                    type: "message",
                    from: "SERVER",
                    message: "Server-side code injection is disabled!"
                }
            ));
            
            return;
        }

        let output = "";
        try{    
            output = eval(...(attributes.splice(1).join(" ")));
        }
        catch (e)
        {
            socket.send(JSON.stringify(
                {
                    type: "message",
                    from: "SERVER",
                    message: "Error: " + e
                }
            ));
            return;
        }

        if(output == undefined) return;

        try{
            socket.send(JSON.stringify(
                {
                    type: "message",
                    from: "SERVER",
                    message: output
                }
            ));
        }
        catch(e)
        {
            socket.send(JSON.stringify(
                {
                    type: "message",
                    from: "SERVER",
                    message: "Cannot send output"
                }
            ));
        }
    }
}

function addMoney(username, amount)
{
    for(let i = 0; i < log["users"].length; i ++)
    {
        if(log["users"][i].username != username) continue;

        log["users"][i].data.money += amount;
        saveLog();
        return;
    }
}

function sendDamagePacket(from, user, damage, knockback)
{
    wss.clients.forEach(client=>{
        if(client.username == user)
        {
            client.send(JSON.stringify({
                type : "damage",
                damage: damage,
                knockback: knockback,
                from: from
            }));
            
            return;
        }
    });
}

function sendKilledPacket(killer)
{
    wss.clients.forEach(client=>{
        if(client.username == killer)
        {
            client.send(JSON.stringify({
                type: "killed"
            }));

            return;
        }
    });
}

function user_signup(username, password, socket)
{
    for(let i = 0; i < log["users"].length; i ++)
    {
        if(log["users"][i].username == username)
        {
            socket.send(JSON.stringify({
                type: "account.create",
                status: false,
                error: "The username is already taken."
            }));
            return;
        }
    }

    const newUser = {
        username: username,
        password: password,
        session: GetID(),
        data: {
            money: config.newbie_money,
            inventory: {
                gun: "gun.pistol",
                projectile: null,
                helmet: null,
                chestplate: null,
                legging: null,
                boot: null
            },
            items: [
                {
                    ID: "gun.pistol",
                    amount: 1
                },
            ]
        }
    };

    log["users"].push(newUser);
    saveLog();

    socket.send(JSON.stringify({
        type: "account.create",
        status: true,
        session: newUser.session
    }));

    console.log(`New user - ${username}`);
}

function user_login(username, password, socket)
{
    for(let i = 0; i < log["users"].length; i ++)
    {
        if(log["users"][i].username != username) continue;
        if(log["users"][i].password != password)
        {
            socket.send(JSON.stringify({
                type: "account.login",
                status: false,
                error: "The password is incorrect."
            }));

            return;
        }

        const sessionID = GetID();
        log["users"][i].session = sessionID;
        saveLog();

        socket.send(JSON.stringify({
            type: "account.login",
            status: true,
            session: sessionID
        }));

        return;
    }

    socket.send(JSON.stringify({
        type: "account.login",
        status: false,
        error: "An account with that username was not found."
    }));

    console.log(`User logged in - ${username}`);
}

function saveLog()
{
    writeFileSync(__dirname + "/userdata.json", JSON.stringify(log, undefined, 4));
}

function saveConfig()
{
    writeFileSync(__dirname + "/properties.json", JSON.stringify(config, undefined, 4));
}

function GetID()
{
    const validChars = "QWERTYUIOPASDFGHJKLZXCVBNM1234567890qwertyuiopasdfghjklzxcvbnm12345678_";
    let id = "";

    for(let i = 0; i < 16; i ++)
    {
        id += validChars[Math.floor(Math.random() * validChars.length)]
    }

    return id;
}

function GetSessionUsername(ID)
{
    for(let i = 0; i < log["users"].length; i ++)
    {
        if(log["users"][i].session == ID) return log["users"][i].username;
    }

    return false;
}

function GetUserData(username)
{
    for(let i = 0; i < log["users"].length; i ++)
    {
        if(log["users"][i].username != username) continue;

        return log["users"][i].data;
    }

    return null;
}

function GetItem(itemID)
{
    const keys = ["Gun", "Projectile", "Armor", "Powerup"];

    let item = null;

    keys.forEach(key=>{
        for(let i = 0; i < shopdata[key].length; i ++)
        {
            if(shopdata[key][i].ID != itemID) continue;

            item = shopdata[key][i];
            return;
        }
    });

    if(item != null) return item;
    
    console.log("Couldn't find item with ID: " + itemID);
    return {ID:"null", "rebuy":false, name:"null", price:0, img: "image/null"};
}


// min inclusive, max exclusive
function IntRandom(min, max)
{
    return Math.floor(Math.random() * (max - min)) + min
}
