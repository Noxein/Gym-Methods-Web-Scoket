var express = require('express');
var app = express();
const expressWs = require('express-ws')(app);
const { pairUsers } = require('./routes/PairUsers');
const { traineeTrainings } = require('./routes/TeaineeTraining');

require('dotenv').config();

app.use(pairUsers);
app.use(traineeTrainings);

app.listen(3004);