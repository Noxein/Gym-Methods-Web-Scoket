var express = require('express');
const traineeTrainings = express();
var expressWs = require('express-ws')(traineeTrainings);
const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');

const clients = new Set();
const sessions = new Map(); // Map to store user sessions and their corresponding WebSocket connections

traineeTrainings.ws('/trainee-training', function(ws, req) {

  clients.add(ws);
  
  ws.on('open', function() {
    console.log('New client connected');
  });

  ws.on('message', async function(msg) {
    //tutaj przychodzi wiadomość ws.send, moze byc to jakis json text
    const parsedMsg = JSON.parse(msg);


    if(parsedMsg.type === 'SET_USER_ID'){
      ws.userid = parsedMsg.userid;
      ws.sessionId = parsedMsg.userid; // For simplicity, we can use the user ID as the session ID, but in a real application, you might want to generate a unique session ID.
    }

    if(parsedMsg.type === 'FIRST_CONNECT') {
      const userid = parsedMsg.userid;
      const userPurpose = parsedMsg.userPurpose; // "Casual" | "Trener" | "Podopieczny trenera"
      const training = parsedMsg.training

      ws.userid = userid;
      ws.userPurpose = userPurpose;
      ws.sessionId = userid; // For simplicity, we can use the user ID as the session ID, but in a real application, you might want to generate a unique session ID.

      sessions.set(userid, training)

      const response = await sql`SELECT id, email FROM gymusers WHERE id = ${userid}`;

      if (response.rows.length === 0) {
        console.log('error: user not found',ws.userid);
        ws.send(JSON.stringify({ type: 'SET_JWT_FAILURE', message: 'User not found' }));
        return;
      }

      const user = response.rows[0];
      ws.userId = user.id;
      ws.email = user.email;

      const token = jwt.sign({ email: user.email, id: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
      ws.send(JSON.stringify({ type: 'SET_JWT_SUCCESS', jwt: token }));

    }

    if (parsedMsg.type === 'TRAINING_UPDATE') {
      const training = parsedMsg.training;
      console.log(training.exercises[0].sets)

      sessions.set(ws.sessionId, training)
      // brodcast to all clients that are in the same session

      clients.forEach((client) => {
        if(client.sessionId === ws.sessionId && client !== ws){
          client.send(JSON.stringify({ type: 'TRAINING_UPDATE', training: training }));
        }
      })

    }

    if(parsedMsg.type === 'TRAINER_CONNECTED') {
      ws.userid = parsedMsg.userid;
      ws.sessionId = parsedMsg.sessionId;
      ws.userPurpose = parsedMsg.userPurpose;

      if(!sessions.has(ws.sessionId)) return

      //send obj to trainer and inform trainee that trainer conneted

      clients.forEach((client) => {
        if(client.sessionId === ws.sessionId && client !== ws){
          client.send(JSON.stringify({ type: 'TRAINER_CONNECTED'}));
        }
      })

    }

    if(parsedMsg.type === 'TRAINER_HOME') {
      console.log(parsedMsg)
      ws.userid = parsedMsg.userid;
      const traineesIds = parsedMsg.traineesIds; // array of trainee ids that should be notified

      let connectedTrainees = [];
      
      traineesIds.forEach(traineeId => {
        if(sessions.has(traineeId)){
          console.log('Trainee with id ' + traineeId + ' is connected');
          //trainee of this id is connected, send back the user id to trainer
          connectedTrainees.push(traineeId);
        }
      })

      if(connectedTrainees.length > 0){
        ws.send(JSON.stringify({ type: 'CONNECTED_TRAINEES', traineesIds: connectedTrainees }));
      }
    }
  });

  ws.on('close', function() {
    console.log(ws.userid + ' disconnected as', ws.userPurpose);
    if(ws.userPurpose === 'Trener'){
      // If the trainer disconnects, we can choose to end the session or notify trainees, but not delete the session, session will be deleted when trainee disconnects.
        clients.forEach((client) => {
          if(client.sessionId === ws.sessionId && client !== ws){
            client.send(JSON.stringify({ type: 'TRAINER_DISCONNECTED'}));
          }
        })
      return clients.delete(ws);
    }

    if(ws.userPurpose === 'Podopieczny trenera'){
      // If the trainee disconnects, we can choose to end the session or notify trainer, but not delete the session, session will be deleted when trainer disconnects.
        clients.forEach((client) => {
          if(client.sessionId === ws.sessionId && client !== ws){
            client.send(JSON.stringify({ type: 'TRAINEE_DISCONNECTED'}));
          }
        })
      return clients.delete(ws);
    }

    
    sessions.delete(ws.userid);

    clients.delete(ws);
  })
  
});

let trainings = [
    {
        traineeID: null,
        trainerID: null,
        training: {}, // 'massive object'
    }
]

module.exports = { traineeTrainings };