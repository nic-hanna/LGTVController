require('dotenv').config();
const fs = require('fs');
const path = require('path');

//Database
const db = require('better-sqlite3')('database.db');
db.pragma('journal_mode = WAL');

//Database exit handler (ensures database is closed on exit even when forced which removes extra files)
process.on('exit', () => db.close());
process.on('SIGHUP', () => process.exit(128 + 1));
process.on('SIGINT', () => process.exit(128 + 2));
process.on('SIGTERM', () => process.exit(128 + 15));

//Router
const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const ejs = require('ejs');

//TV
const { LGTV, EnergySavingLevels } = require('lgtv-ip-control');

//Express
app.set('view engine', "ejs");
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())
app.use('/public', express.static(path.join(__dirname, 'public')));

var port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Listening on port ${port}`)
})

//TVs
let tvList
function initialiseTVs (){
    tvList = {}
    db.prepare('SELECT * FROM tvs').all().forEach(tv => {
        if (!tv.ip || !tv.keycode) return console.error("TV " + tv.id + " is missing either an IP or keycode");
        tvList[tv.id] = new LGTV(tv.ip, tv.mac, tv.keycode);
    })
};

initialiseTVs();

//GUI
app.get('/', (req, res) => {
    res.redirect('/status')
})

app.get('/status', (req, res) => {
    res.render('status')
})

app.get('/tvs', (req, res) => {
    res.render('tvs')
})

app.get('/remote', (req, res) => {
    res.render('remote')
})

app.get('/schedule', (req, res) => {
    res.render('schedule')
})

//Management
app.post('/manage/tv/new', (req, res) => {
    if (!req.body.ip || !req.body.keycode) return res.status(400).send("Missing either IP or keycode");
    db.prepare('INSERT INTO tvs (ip, mac, keycode, name) VALUES (?, ?, ?, ?)')
    .run(req.body.ip, req.query.mac, req.body.keycode, req.query.name);
    res.send(200)
})

app.post('/manage/tv/update', (req, res) => {
    if (!req.body.id) return res.status(400).send("Missing TV id");
})


//API
app.get('/api/volume/:tv', (req, res) => {
    if (!tvList[req.params.tv]) return res.status(400).send("Invalid TV id: " + req.params.tv + ".");
    tvList[req.params.tv].connect().then(async () => {
        var volume = await tvList[req.params.tv].getCurrentVolume();
        var muteState = await tvList[req.params.tv].getMuteState();
        res.status(200).send({
            "mute": muteState,
            "volume": volume
        });
        tvList[req.params.tv].disconnect();
    });
});

app.get('/api/ipControlState/:tv', (req, res) => {
    if (!tvList[req.params.tv]) return res.status(400).send("Invalid TV id: " + req.params.tv + ".");
    tvList[req.params.tv].connect().then(async () => {
        var controlState = await tvList[req.params.tv].getIpControlState();
        res.status(200).send(controlState);
        tvList[req.params.tv].disconnect();
    })
});

var allowedInterface = ['wired', 'wifi'];
app.get('/api/setMACAddress/:tv/:interface', (req, res) => {
    var interface = req.params.interface
    if (!allowedInterface.includes(interface)) return res.status(400).send("Invalid interface: Either 'wired' or 'wifi'");
    tvList[req.params.tv].connect().then(() => {
        tvList[req.params.tv].getMacAddress(interface).then((address) => {
            console.log(address)
            db.prepare('UPDATE tvs SET mac = ? WHERE id = ?').run(address, req.params.tv);
            res.status(200).send(address);
            tvList[req.params.tv].disconnect();
        })
    })
});

var allowedStates = ["on", "off"];
app.post('/api/power/:tvs/:state', (req, res) => {
    var state = req.params.state;
    if (!allowedStates.includes(state)) return res.status(400).send("Invalid state: Either 'on' or 'off'");
    var tvs = req.params.tvs.split(',');
    var errors = "";
    tvs.forEach(tv => {
        if (!tvList[tv]) return errors += "Invalid TV id: " + tv.id + ".<br>";
        tvList[tv].connect()
        .then( async () => {
            if (req.params.state == "on") {
                tvList[tv].powerOn()
                console.log("On")
            } else if (req.params.state == "off") {
                tvList[tv].powerOff()
            }
            tvList[tv].disconnect();
        });
    });
    if (!errors) return res.sendStatus(200);
    res.status(500).send(errors);
})

var allowedInputs = ["dtv", "atv", "cadtv", "catv", "av", "component", "hdmi1", "hdmi2", "hdmi3", "hdmi4"]
app.post('/api/input/:tvs/:input', (req, res) => {
    var input = req.params.input;
    if (!allowedInputs.includes(input)) return res.status(400).send("Invalid input");
    var tvs = req.params.tvs.split(',');
    var errors = "";
    tvs.forEach(tv => {
        if (!tvList[tv]) return errors += "Invalid TV id: " + tv.id + ".<br>";
        tvList[tv].connect()
        .then( async () => {
            tvList[tv].setInput(input)
            tvList[tv].disconnect();
        })
    })
    if (!errors) return res.sendStatus(200);
    res.status(500).send(errors);
})

//volume

//mute
app.post('/api/mute/:tvs/:state', (req, res) => {
    var state = !!+req.params.state;
    if (![true, false].includes(state)) return res.status(400).send("Invaild state");
    var tvs = req.params.tvs.split(',');
    var errors = "";
    tvs.forEach(tv => {
        if (!tvList[tv]) return errors += "Invalid TV id: " + tv.id + ".<br>";
        tvList[tv].connect().then( async () => {
            tvList[tv].setVolumeMute(state)
            tvList[tv].disconnect();
        });
    })
    if (!errors) return res.sendStatus(200);
    res.status(400).send(errors);
});

//sendKey
var allowedKeys = ["arrowdown","arrowleft","arrowright","arrowup","aspectratio","audiomode","returnback","bluebutton","captionsubtitle","channeldown","channellist","channelup","deviceinput","screenbright","fastforward","greenbutton","myapp","programminfo","livetv","settingmenu","number0","number1","number2","number3","number4","number5","number6","number7","number8","number9","ok","play","previouschannel","programguide","record","redbutton","rewind","sleepreserve","userguide","videomode","volumedown","volumemute","volumeup","yellowbutton"]
app.post('/api/key/:tvs/:key', (req, res) => {
    var key = req.params.key;
    console.log(key);
    if (!allowedKeys.includes(key)) return res.status(400).send("Invalid key");
    var tvs = req.params.tvs.split(',');
    var errors = "";
    tvs.forEach(tv => {
        if (!tvList[tv]) return errors += "Invalid TV id: " + tv.id + ".<br>";
        tvList[tv].connect().then( async () => {
            tvList[tv].sendKey(key)
            tvList[tv].disconnect();
        });
    })
    if (!errors) return res.sendStatus(200);
    res.status(500).send(errors);
});

//Energy Saving
var allowedEnergySavingLevels = ["auto", "screenOff", "maximum", "medium", "minimum", "off"];
app.post('/api/energyLevel/:tvs/:level', (req, res) => {
    var level = req.params.level;
    if (!allowedEnergySavingLevels.includes(level)) return res.status(400).send("Invalid level");
    var tvs = req.params.tvs.split(',');
    var errors = "";
    tvs.forEach(tv => {
        if (!tvList[tv]) return errors += "Invalid TV id: " + tv.id + ".<br>";
        tvList[tv].connect().then( async () => {
            tvList[tv].setEnergySaving(EnergySavingLevels[level])
            tvList[tv].disconnect();
        });
    })
    if (!errors) return res.send(200);
    res.status(500).send(errors);
});


