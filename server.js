require('dotenv').config();

const express = require('express');
const { XMLParser } = require('fast-xml-parser');
const { fetch, setGlobalDispatcher, Agent } = require('undici');
const { launchBrowser, generateRecaptchaToken } = require('./recaptcha');
const { connect, getSocketResponse } = require('./socket');
const bodyParser = require('body-parser');

setGlobalDispatcher(new Agent({connect: {timeout: 60_000}}));

const PORT = process.env.PORT ?? 3000;
const servers = {};

/*
    Example of a request:
    http://localhost:3000/EmpireEx_2/lli/{"CONM":175,"RTM":24,"ID":0,"PL":1,"NOM":"supremeplayzbs@gmail.com","PW":"jamiliboy2022","LT":null,"LANG":"en","DID":"0","AID":"1660851768802609520","KID":"","REF":"https://empire.goodgamestudios.com","GCI":"","SID":9,"PLFID":1}



*/

async function get_sockets() {
    let servers_file = await fetch("https://empire-html5.goodgamestudios.com/config/network/1.xml");
    servers_file = new XMLParser().parse(await servers_file.text());
    for (instance of servers_file.network.instances.instance) {
        if (instance.zone == "EmpireEx_2" && !(instance.zone in servers)) {
            servers[instance.zone] = {url: `wss://${instance.server}`, reconnect: true, messages: [], responses: []};
            connect(servers, instance.zone);
        }
    }
    setTimeout(get_sockets, 3600000);
}

get_sockets();

const app = express();

app.use(bodyParser.json());
app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    next();
});

// app.get("/:server/:command/:headers", async (req, res) => {
//     if (req.params.server in servers) {
//         try {
//             let JSONheaders = JSON.parse(`{${req.params.headers}}`);
//             servers[req.params.server].socket.send(`%xt%${req.params.server}%${req.params.command}%1%{${req.params.headers}}%`);
//             servers[req.params.server].messages.push({server: req.params.server, command: req.params.command, headers: JSONheaders});
//             res.json(await getSocketResponse(servers, {server: req.params.server, command: req.params.command, headers: JSONheaders}, 0));    
//         }
//         catch {
//             res.json({server: req.params.server, command: req.params.command, return_code: "-1", content: {"error": "Bad request"}});    
//         }
//     }
//     else {
//         res.json({server: req.params.server, command: req.params.command, return_code: "-1", content: {"error": "This server is currently not supported"}});    
//     }
// });

app.get("/:server/:command/:headers", async (req, res) => {
    console.log("Received headers:", req.params.headers);
    if (req.params.server in servers) {
        try {
            let decodedHeaders = decodeURIComponent(req.params.headers);
            console.log("Decoded headers:", decodedHeaders);
            let JSONheaders = JSON.parse(decodedHeaders);

            // Sende die WebSocket-Nachricht
            servers[req.params.server].socket.send(`%xt%${req.params.server}%${req.params.command}%1%${decodedHeaders}%`);

            // Füge die Anfrage zu den Nachrichten hinzu
            servers[req.params.server].messages.push({server: req.params.server, command: req.params.command, headers: JSONheaders});
            
            // Warte auf die Antwort über WebSocket und gebe die Antwort zurück
            const response = await getSocketResponse(servers, {server: req.params.server, command: req.params.command, headers: JSONheaders}, 0);
            
            // Wenn die Antwort nicht leer ist, gib die Mapdaten zurück
            if (response.content && Object.keys(response.content).length > 0) {
                res.json({
                    server: response.server,
                    command: response.command,
                    return_code: response.return_code,
                    content: response.content // Hier sind die Mapdaten
                });
            } else {
                res.json({
                    server: response.server,
                    command: response.command,
                    return_code: response.return_code,
                    content: {
                        error: "No data received"
                    }
                });
            }

        } catch (error) {
            console.error("Error processing request:", error);
            res.json({
                server: req.params.server,
                command: req.params.command,
                return_code: "-1",
                content: {
                    error: "Bad request",
                    details: error.message
                }
            });
        }
    } else {
        res.json({
            server: req.params.server,
            command: req.params.command,
            return_code: "-1",
            content: {
                error: "This server is currently not supported"
            }
        });
    }
});

app.post("/recaptcha", async (req, res) => {
    if (req.body.site_key == process.env.SITE_KEY) {
        const puppeteerInstance = await launchBrowser();
        res.status(200).json({token: await generateRecaptchaToken(puppeteerInstance.frame)});
        puppeteerInstance.browser.close();
    }
    else {
        res.status(401).json({token: null});    
    }
});

app.listen(PORT, () => console.log(`Express Server listening on port ${PORT}`));