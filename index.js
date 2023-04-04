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
const { LGTV } = require('lgtv-ip-control');

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
var tvs = {}
db.prepare('SELECT * FROM tvs').all().forEach(tv => {
    tvs[id] = new LGTV(tv.ip, tv.mac, tv.keycode).connect();
})


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



