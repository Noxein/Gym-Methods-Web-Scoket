const jwt = require('jsonwebtoken');
const { v4 } = require('uuid');
const { sql } = require('@vercel/postgres');
var express = require('express');
const pairUsers = express();
var expressWs = require('express-ws')(pairUsers);
//const pairUsers = express.Router()

const clients = new Set();

pairUsers.ws('/pairUsers', function(ws, req) {

  ws.on('message', async function(msg) {
    //tutaj przychodzi wiadomość ws.send, moze byc to jakis json text
    const parsedMsg = JSON.parse(msg);
    
    if(parsedMsg.type === 'CONFIRM_PAIRING') {
      const userid = ws.userId;
      const traineeID = pairs[parsedMsg.code].traineeID;

      const JWTData = jwt.verify(parsedMsg.jwt, process.env.JWT_SECRET,(err, decoded) =>{
        if(err) {
          console.log('JWT verification error:', err);
          return null;
        }
        return decoded;
      });

      console.log(JWTData); // { email, id ,iat, exp}

      if(JWTData.id !== userid) {
        ws.send(JSON.stringify({ type: 'PAIRING_FAILURE', message: 'Invalid JWT' }));
        return;
      }

      //here add to database the link between trainer and trainee

      const result = await sql`INSERT INTO trainertrainee (id, trainerid, traineeid, pairedat) VALUES (${v4()},${userid}, ${traineeID}, ${JSON.stringify(new Date())})`;

      if(result.rowCount === 1) {
        ws.send(JSON.stringify({ type: 'PAIRING_SUCCESS', message: 'Pairing successful' }));

        clients.forEach((client) => {
          if(client.userId === traineeID){
            client.send(JSON.stringify({ type: 'PAIRING_SUCCESS', message: 'Pairing successful' }));
          }
        })
      }else{
        ws.send(JSON.stringify({ type: 'PAIRING_FAILURE', message: 'Database error' }));
      }


    }
    if(parsedMsg.type === 'TRAINEE_CONNECT_CODE') {
      const code = parsedMsg.code;

      if(!pairs[code]) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid code' }));
        return;
      }
      console.log(code)
      pairs[code].traineeID = ws.userId;

      //add link between users to database, send to all ws connections that trainee connected to trainer

      ws.send(JSON.stringify({ type: 'TRAINEE_CONNECT_CORRECT', message: 'Code correct, waiting for trainer to accept', trainerID: pairs[code].trainerID }));
      // send to all connected trainers that a trainee connected
       
      clients.forEach((client) => {
        console.log(client);
        if(client.userId === pairs[code].trainerID){
          const traineeName = ws.email

          let objectToSend = { 
            type: 'PAIR_SUCCESSFULLY', 
            traineeInfo: { name: traineeName },
          };

          client.send(JSON.stringify(objectToSend));
        }

        //client.send(JSON.stringify({ type: 'TRAINEE_CONNECTED', traineeID: pairs[code].traineeID, trainerID: pairs[code].trainerID }));
      })
      
    }
    if (parsedMsg.type === 'SET_JWT') {
      clients.add(ws);

      const userid = parsedMsg.userid;
      ws.userid = userid;
      
      //query db to validate jwt and get username and get other user data
      //store username in ws object
      

      const response = await sql`SELECT id, email FROM gymusers WHERE id = ${userid}`;

      if (response.rows.length === 0) {
        console.log('error: user not found',ws.userid);
        ws.send(JSON.stringify({ type: 'SET_JWT_FAILURE', message: 'User not found' }));
        return;
      }

      const user = response.rows[0];
      ws.userId = user.id;
      ws.email = user.email;

      console.log(ws.userId)

      //send back jwt token or error message
      //check if userid exists in pairs object

      resetTraineeCode(ws.userId);

      const token = jwt.sign({ email: user.email, id: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

      let objectToSend = { type: 'SET_JWT_SUCCESS', token: token };

      if(parsedMsg.requestedKey) {
        const key = v4().slice(0,6).toUpperCase();
        objectToSend.requestedKey = key

        pairs[key] = {
          trainerID: ws.userId,
          traineeID: null,
          createdAt: new Date(),
        }

      }

      ws.send(JSON.stringify(objectToSend));

    }

    if(parsedMsg.type === 'SET_TRAINER_CODE') {

    }
    if(parsedMsg.type === 'LOG_USERNAME') {
      console.log(ws.userid);
    }
  });

  ws.on('close', function() {
    console.log(ws.userId + ' disconnected');

    resetTraineeCode(ws.userId);

    clients.delete(ws);
  })
  
});

const resetTraineeCode = (userId) => {
      pairs = Object.fromEntries(
      Object.entries(pairs).filter(([key, value]) => {
        //check if given traineeID is null, if its not null send to trainee code reset 
        const isTrainerOrTrainee = value.trainerID === userId || value.traineeID === userId;

        if(isTrainerOrTrainee && !(value.traineeID === null)) {
          //send to trainee code reset

          clients.forEach((client) => {
            if(client.userId === value.traineeID){
              client.send(JSON.stringify({ type: 'RESET_TRAINING_CODE', message: 'Your training code has been reset by the trainer.' }));
            }
          })

        }

        return !isTrainerOrTrainee
      })
    );
}

let pairs = {
  'AAABBB': {
    trainerID: null,
    traineeID: null,
    createdAt: new Date(),
  }
}

module.exports = { pairUsers };