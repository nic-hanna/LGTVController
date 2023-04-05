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


//API
app.get('/api/volume/:tv', (req, res) => {
    var tv = tvList[req.params.tv];
    if (!tv) return res.sendStatus(400);
    tv.getCurrentVolume().then(volume => {
        tv.getMuteState().then(muteState => {
            res.status(200).send({
                "mute": muteState,
                "volume": volume
            });
        }).catch(err => {
            res.status(500).send(err);
        })
    }).catch(err => {
        res.status(500).send(err);
    })
});

app.get('/api/ipControlState/:tv', (req, res) => {
    var tv = tvList[req.params.tv];
    if (!tv) return res.status(400).send("Invalid TV id: " + tv.id + ".");
    tv.getIpControlState().then((controlState) => {
        console.log(controlState);
        res.status(200).send(controlState);
    })
});

app.get('/api/muteState/:tv', (req, res) => {
    var tv = tvList[req.params.tv];
    if (!tv) return res.status(400).send("Invalid TV id: " + tv.id + ".");
    tv.getMuteState().then((muteState) => {
        console.log(muteState);
        res.status(200).send(muteState);
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
    var tvs = req.params.tvs.split(',');
    var input = req.params.input;
    if (!allowedInputs.includes(input)) return res.status(400).send("Invalid input");
    var errors = "";
    tvs.forEach(tv => {
        var tv = tvList[tv];
        if (!tv) return errors += "Invalid TV id: " + tv.id + ".<br>";
        tv.setInput(Inputs[input]).catch(err => {
            errors += "Error setting input for TV " + tv.id + ": " + err + ".<br>";
        })
    })
    if (!errors) return res.send(200);
    res.status(500).send(errors);
})

//volume

//mute
app.post('/api/mute/:tvs/:state', (req, res) => {
    var tvs = req.params.tvs.split(',');
    var state = req.params.state;
    if (state !== "1" || state !== "0") return res.status(400).send("Invaild state");
    var errors = "";
    tvs.forEach(tv => {
        var tv = tvList[tv];
        if (!tv) return errors += "Invalid TV id: " + tv.id + ".<br>";
        tv.setVolumeMute(!!+state).catch(err => {
            errors += "Error setting volume mute for TV " + tv.id + ": " + err + ".<br>";
        })
    })
    if (!errors) return res.send(200);
    res.status(500).send(errors);
});

//sendKey
var allowedKeys = ["arrowDown","arrowLeft","arrowRight","arrowUp","aspectRatio","audioMode","back","blueButton","captionSubtitle","channelDown","channelList","channelUp","deviceInput","energySaving","fastForward","greenButton","home","info","liveTV","menu","number0","number1","number2","number3","number4","number5","number6","number7","number8","number9","ok","play","previousChannel","programGuide","record","redButton","rewind","sleepTimer","userGuide","videoMode","volumeDown","volumeMute","volumeUp","yellowButton"]
app.post('/api/key/:tvs/:key', (req, res) => {
    var tvs = req.params.tvs.split(',');
    var key = req.params.key;
    if (!allowedKeys.includes(key)) return res.status(400).send("Invalid key");
    var errors = "";
    tvs.forEach(tv => {
        var tv = tvList[tv];
        if (!tv) return errors += "Invalid TV id: " + tv.id + ".<br>";
        tv.sendKey(Keys[key]).catch(err => {
            errors += "Error sending key for TV " + tv.id + ": " + err + ".<br>";
        })
    })
    if (!errors) return res.send(200);
    res.status(500).send(errors);
});

//Energy Saving
var allowedEnergySavingLevels = ["auto", "screenOff", "maximum", "medium", "minimum", "off"];
app.post('/api/energyLevel/:tvs/:lvel', (req, res) => {
    var tvs = req.params.tvs.split(',');
    var level = req.params.level;
    if (!allowedEnergySavingLevels.includes(level)) return res.status(400).send("Invalid level");
    var errors = "";
    tvs.forEach(tv => {
        var tv = tvList[tv];
        if (!tv) return errors += "Invalid TV id: " + tv.id + ".<br>";
        tv.setEnergySaving(EnergySavingLevels[level]).catch(err => {
            errors += "Error setting Enegery Saving Level for TV " + tv.id + ": " + err + ".<br>";
        })
    })
    if (!errors) return res.send(200);
    res.status(500).send(errors);
});


