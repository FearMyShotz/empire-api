
const WebSocket = require('ws');
const commands = require('./commands.json');

const USER_NAME = process.env.USER_NAME;
const PASSWORD = process.env.PASSWORD;

function compare_mess_resp(mess, resp) {
    if (mess.command != resp.command) {
        return false;
    }
    if (mess.command in commands) {
        for (let [mess_key, resp_key] of Object.entries(commands[mess.command])) {
            if (mess_key in mess.headers) {
                let mess_val = mess.headers[mess_key];
                let resp_val = resp_key.split('.').reduce((o, k) => o && o[k], resp.content)
                if (typeof(mess_val) == "string" && typeof(resp_val) == "string") {
                    if (mess_val.toLowerCase() != resp_val.toLowerCase()) {
                        return false;
                    }
                }
                else if (mess_val != resp_val) {
                    return false;
                }
            }
        }    
    }
    else {
        for (header in mess.headers) {
            if (mess.headers[header] == resp.content[header]) {
                return false;
            }
        }
    }
    return true;
}

function connect(servers, header) {
    let socket = servers[header].socket = new WebSocket(servers[header].url);
    socket.addEventListener('open', (event) => {
        console.log(`### socket ${header} connected ###`)
        socket.send(`<msg t='sys'><body action='login' r='0'><login z='${header}'><nick><![CDATA[]]></nick><pword><![CDATA[1065004%fr%0]]></pword></login></body></msg>`);
        socket.send(`%xt%${header}%lli%1%{"CONM":175,"RTM":24,"ID":0,"PL":1,"NOM":"${USER_NAME}","PW":"${PASSWORD}","LT":null,"LANG":"fr","DID":"0","AID":"1674256959939529708","KID":"","REF":"https://empire.goodgamestudios.com","GCI":"","SID":9,"PLFID":1}%`);
    });

    socket.addEventListener('message', async (event) => {
        console.log(`Received message: ${event.data}`); // Logging der Rohdaten
        let response = event.data.toString().split("%");
        // console.log(`Raw response split: ${JSON.stringify(response)}`); // Logging der aufgeteilten Antwort
    
        response = {server: header, command: response[2], return_code: response[4], content: response[5]};
        
        try {
            response.content = JSON.parse(response.content ?? "{}");
            // console.log(`Parsed response content: ${JSON.stringify(response.content)}`);
        }
        catch (error) {
            console.error(`Error parsing response content: ${error.message}`); // Fehlerbehandlung für JSON Parsing
            response.content = { error: "Invalid JSON format" }; // Fallback für ungültiges JSON
        }
    
        if (response.command === "lli") {
            if (response.return_code === "0") {
                ping_socket(socket, header);
            } else if (response.return_code === "21") {
                socket.send(`%xt%${header}%lre%1%{"DID":0,"CONM":515,"RTM":60,"campainPId":-1,"campainCr":-1,"campainLP":-1,"adID":-1,"timeZone":14,"username":"${USER_NAME}","email":null,"password":"${PASSWORD}","accountId":"1681390746855129824","ggsLanguageCode":"fr","referrer":"https://empire.goodgamestudios.com","distributorId":0,"connectionTime":515,"roundTripTime":60,"campaignVars":";https://empire.goodgamestudios.com;;;;;;-1;-1;;1681390746855129824;0;;;;;","campaignVars_adid":"-1","campaignVars_lp":"-1","campaignVars_creative":"-1","campaignVars_partnerId":"-1","campaignVars_websiteId":"0","timezone":14,"PN":"${USER_NAME}","PW":"${PASSWORD}","REF":"https://empire.goodgamestudios.com","LANG":"fr","AID":"1681390746855129824","GCI":"","SID":9,"PLFID":1,"NID":1,"IC":""}%`);
            } else {
                socket.close();
            }
        } else if (response.command === "lre") {
            if (response.return_code === "0") {
                ping_socket(socket, header);
            } else {
                servers[header].reconnect = false;
                socket.close();
            }
        } else {
            if (servers[header].messages.some(message => compare_mess_resp(message, response))) {
                servers[header].responses.push(response);
            }
        }
    });    

    socket.addEventListener('error', (event) => {
        console.log(`### error in socket ${header} ###`);
        console.log(event.message);
        if (["ENOTFOUND", "ETIMEDOUT"].includes(event.error.code)) {
            servers[header].reconnect = false;
        }
        socket.close();
    });

    socket.addEventListener('close', (event) => {
        console.log(`### socket ${header} closed ${servers[header].reconnect ? "" : "permanently "}###`);
        if (servers[header].reconnect) {
            setTimeout(() => connect(servers, header), 10000);
        }
        else {
            delete servers[header];
        }
    });
}

// async function getSocketResponse(servers, message, nb_try) {
//     if (nb_try < 20) {
//         let response;
//         response = servers[message.server].responses.find(response => compare_mess_resp(message, response));
//         if (response != undefined) {
//             servers[response.server].responses.splice(servers[response.server].responses.indexOf(response), 1);
//             servers[message.server].messages.splice(servers[message.server].messages.indexOf(message), 1);
//             return response;    
//         }
//         else {
//             return await new Promise(resolve => setTimeout(() => resolve(getSocketResponse(servers, message, nb_try + 1)), 50))
//         }
//     }
//     else {
//         servers[message.server].messages.splice(servers[message.server].messages.indexOf(message), 1);
//         return {server: message.server, command: message.command, return_code: "-1", content: {}};
//     }
// }
async function getSocketResponse(servers, message, nb_try) {
    if (nb_try < 20) {
        let response;
        response = servers[message.server].responses.find(response => compare_mess_resp(message, response));
        
        // Logging der empfangenen Nachrichten
        if (response !== undefined) {
            console.log("Response received:", response);
            servers[response.server].responses.splice(servers[response.server].responses.indexOf(response), 1);
            servers[message.server].messages.splice(servers[message.server].messages.indexOf(message), 1);
            return response;    
        } else {
            console.log("No response yet, waiting...");
            return await new Promise(resolve => setTimeout(() => resolve(getSocketResponse(servers, message, nb_try + 1)), 50));
        }
    } else {
        servers[message.server].messages.splice(servers[message.server].messages.indexOf(message), 1);
        return {server: message.server, command: message.command, return_code: "-1", content: {error: "No data received after multiple attempts"}};
    }
}


function ping_socket(socket, header) {
    if (socket.readyState != WebSocket.CLOSED && socket.readyState != WebSocket.CLOSING) {
        socket.send(`%xt%${header}%pin%1%<RoundHouseKick>%`);
        setTimeout(() => ping_socket(socket, header), 60000);
    }
}

module.exports = { connect, getSocketResponse };
