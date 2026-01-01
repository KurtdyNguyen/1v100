import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import questionData from '../question-bank.json';


const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    playerNo: activePlayers.size,
    questionNo: questionData.length,
    gameState: gameState
  });
});

const activePlayers = new Map();
const playerNames = new Set(); //trùng tên thì hơi khó truy xuất nên dùng set chỉ lấy giá trị unique cho chắc
const eliminatedPlayers = new Set<string>();

let gameState: 'waiting' | 'first-question' | 'main-game' | 'result' = 'waiting';
let hostPlayerId: string | null = null;
let mainPlayerId: string | null = null;
let questionTimeout: NodeJS.Timeout | null = null;
let supportingQuestionTimeout: NodeJS.Timeout | null = null;
let playerAnswers = new Map(); //{câu trả lời, thời gian trả lời, đúng?}
let usedQuestion = new Set<number>();


function getRandomQuestion(){
  const available = Array.from(Array(questionData.length).keys()).filter(index => !usedQuestion.has(index));

  if (available.length === 0){
    usedQuestion.clear();
    return getRandomQuestion();
  }

  const randomIndex = available[Math.floor(Math.random() * available.length)];
  usedQuestion.add(randomIndex);

  const q = questionData[randomIndex];
  return{
    question: q.question_text,
    options: q.options,
    answer: q.correct_answer,
    explanation: q.explanation
  };
}

let currentQuestion: any = null;
let firstCorrectAnswerPlayerId: string | null = null;

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-game', (playerName) => {
    const cleanPlayerName = playerName.trim();

    if(gameState === 'result'){
      socket.emit('join-error', { 
        message: 'Game is deducting result. Please wait to join a new game.'
      });
      return;
    }

    if(playerNames.has(cleanPlayerName)){
      socket.emit('join-error', { 
        message: `Name "${cleanPlayerName}" taken. Choose another.`
      });
      return;
    };

    console.log(`Player ${cleanPlayerName} joined the game`);
    
    const player = {
        id: socket.id,
        name: cleanPlayerName,
        points: 10,
        isHostPlayer: false,
        isMainPlayer: false,
        isEliminated: false,
        joinedAt: new Date().toISOString()
    };

    if(activePlayers.size === 0){
      player.isHostPlayer = true;
      hostPlayerId = socket.id;
      console.log(`${cleanPlayerName} is the host of this game.`)
    }

    activePlayers.set(socket.id, player); //lưu
    playerNames.add(cleanPlayerName);

    socket.emit('join-success', player);
    socket.broadcast.emit('player-joined', player);

    const playerList = Array.from(activePlayers.values());
    io.emit('player-list-update', playerList);
    
    console.log(`Total players: ${activePlayers.size}`);
  });

  socket.on('start-game', () => { //người đầu tiên vào phòng có quyền bắt đầu
    //test
    console.log("=== BACKEND: start-game received ===");
    console.log("From socket:", socket.id);
    console.log("Player:", activePlayers.get(socket.id)?.name);
    console.log("Is host?", socket.id === hostPlayerId);
    console.log("Player count:", activePlayers.size);
    console.log("Game state:", gameState);

    const player = activePlayers.get(socket.id);
    if (!player){
      socket.emit('error', {message: 'You are not in any game.'});
      return;
    }
    if (socket.id !== hostPlayerId){
      socket.emit('error', {message: 'Only host player can start the game.'});
      return;
    }
    if (activePlayers.size < 2){
      socket.emit('error', {message: 'Need at least 2 players to start the game.'});
      return;
    }
    if (activePlayers.size > 100){
      socket.emit('error', {message: 'Exceed maximum capacity of 100 players, cannot start the game.'});
      return;
    }
    if (gameState !== 'waiting') {
      socket.emit('error', {message: 'Game is already running.'});
      return;
    }

    console.log('Game started.');
    startNewQuestion('first-question');
  });

  socket.on('player-answer', (answerData: {answer: string}) =>{
    const player = activePlayers.get(socket.id);
    if(!player || player.isEliminated) return;
    if(gameState !== 'first-question' && gameState !== 'main-game') return;

    const isCorrect = answerData.answer === currentQuestion.answer;
    console.log(`${player.name} answered "${answerData.answer}" ${isCorrect? 'correct' : 'wrong'}`);

    if (playerAnswers.has(socket.id)) return;

    playerAnswers.set(socket.id, {
      answer: answerData.answer,
      isCorrect: isCorrect
    });

    if(gameState === 'first-question' && isCorrect && firstCorrectAnswerPlayerId === null){
      firstCorrectAnswerPlayerId = socket.id;
      console.log(`${player.name} is the first to answer it correctly and become the main player.`);
      io.emit('first-correct-answer',{
        playerId: socket.id,
        playerName: player.name
      });
    }

    /* if (gameState === 'main-game' && socket.id === mainPlayerId){
      handleMainPlayerAnswer(player, isCorrect);
    } */

    if(checkAllPlayersAnswered()){
      console.log('All players have answered. Ending the question early.');
      if(gameState === 'first-question'){
        getMainPlayer();
      } else {
        endQuestion();
      }
      return;
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    const player = activePlayers.get(socket.id);

    if(player){
      const wasHost = socket.id === hostPlayerId;
      const wasMain = socket.id === mainPlayerId;
      const playerName = player.name;

      activePlayers.delete(socket.id);
      playerNames.delete(player.name);
      eliminatedPlayers.delete(socket.id);
      playerAnswers.delete(socket.id);

      if(wasHost){
        console.log(`Host ${playerName} left. Selecting new host...`);
        selectNewHostPlayer();
      }

      if(wasMain){
        console.log(`Main player ${playerName} left.`);
        mainPlayerId = null;
      }

      socket.broadcast.emit('player-left', {
        id: socket.id,
        name: player.name
      });

      const playerList = Array.from(activePlayers.values());
      io.emit('player-list-update', playerList);

      console.log(`Player ${player.name} left. Current player count ${activePlayers.size}`);
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

///////////

function getMainPlayer(){
  if(questionTimeout){
    clearTimeout(questionTimeout);
    questionTimeout = null;
  }

  if(firstCorrectAnswerPlayerId){
    setTimeout(() => {
      mainPlayerId = firstCorrectAnswerPlayerId;

      const allPlayers = Array.from(activePlayers.values());
      allPlayers.forEach(player => {
        if(player.id === mainPlayerId){
          player.isMainPlayer = true;
          console.log(`${player.name} is the main player`);
        } else {
          player.isMainPlayer = false;
        }
        activePlayers.set(player.id, player);
      });

      io.emit('main-player-selected', {
        playerId: mainPlayerId,
        playerName: activePlayers.get(mainPlayerId)?.name
      });

      setTimeout(() => {
        startNewQuestion('main-game');
      }, 1000)
    }, 5000);
    
  } else {
    console.log('No correct answer. Restarting first question...');
    startNewQuestion('first-question')
  }
}

function startNewQuestion(phase: 'first-question' | 'main-game'){

  if(questionTimeout){
    clearTimeout(questionTimeout);
    questionTimeout = null;
  }
  if(supportingQuestionTimeout){
    clearTimeout(supportingQuestionTimeout);
    supportingQuestionTimeout = null;
  }

  gameState = phase;
  currentQuestion = getRandomQuestion();
  playerAnswers.clear();

  if(phase === 'first-question'){
    firstCorrectAnswerPlayerId = null;
    console.log(`First question: ${currentQuestion.question}`);
  } else {
    console.log(`Main question: ${currentQuestion.question}`);
  }

  const optionsArray = Object.entries(currentQuestion.options).map(([abcd, text]) => ({
    abcd,
    text
  }));

  const baseTimeLimit = phase === 'first-question'? 30 : 60;
  const mainPlayer = mainPlayerId? activePlayers.get(mainPlayerId) : null;

  io.emit('new-question', {
    question: currentQuestion.question,
    options: optionsArray,
    timeLimit: baseTimeLimit,
    phase: phase,
    mainPlayerId: mainPlayerId,
    mainPlayerName: mainPlayer?.name
  });

  if(phase === 'main-game' && mainPlayerId){
    supportingQuestionTimeout = setTimeout(() => {
      const supportingPlayersHaventAnswered = Array.from(activePlayers.values()).filter(p => !p.isMainPlayer && !p.isEliminated && !playerAnswers.has(p.id));
      supportingPlayersHaventAnswered.forEach(p => {
        playerAnswers.set(p.id, {
          answer: 'N/A',
          isCorrect: false
        });
        console.log(`Supporting player ${p.name} auto-submitted at 30s mark.`);

        if (playerAnswers.has(mainPlayerId)){
          console.log('Main player answered before 30s, ending question early.');
          endQuestion();
        }
      })
    }, 30000);

    questionTimeout = setTimeout(() => {
      if(supportingQuestionTimeout){
        clearTimeout(supportingQuestionTimeout);
        supportingQuestionTimeout = null;
      }

      if(!playerAnswers.has(mainPlayerId)){
        const mainPlayer = activePlayers.get(mainPlayerId);
        if(mainPlayer){
          playerAnswers.set(mainPlayerId, {
            answer: 'N/A',
            isCorrect: false
          });
          console.log(`Main player ${mainPlayer.name} didn't answer in 60s.`);
        }
        endQuestion();
      }
    }, 60000);
  } else {
    questionTimeout = setTimeout(() => {
      if(gameState === phase){
        if(phase === 'first-question'){
          getMainPlayer();
        } else {
          endQuestion();
        }
      }
    },baseTimeLimit * 1000);
  }
}

function endQuestion(){

  if(questionTimeout){
    clearTimeout(questionTimeout);
    questionTimeout = null;
  }
  if(supportingQuestionTimeout){
    clearTimeout(supportingQuestionTimeout);
    supportingQuestionTimeout = null;
  }

  gameState = 'result';
  console.log(`Question ended. Correct answer: ${currentQuestion.answer}.`);

  if(mainPlayerId){
    const mainPlayer = activePlayers.get(mainPlayerId);
    const mainPlayerAnswer = playerAnswers.get(mainPlayerId);
    const isMainPlayerCorrect = mainPlayerAnswer?.isCorrect || false;

    console.log(`Main player ${mainPlayer?.name} gave the ${isMainPlayerCorrect? 'correct' : 'wrong'} answer.`);
    
    const supportingPlayers = Array.from(activePlayers.values()).filter(p => !p.isMainPlayer && !p.isEliminated);
    if(isMainPlayerCorrect){
      const wrongSupportingPlayers = supportingPlayers.filter(p => {
        const answer = playerAnswers.get(p.id);
        return !answer || !answer.isCorrect;
      });

      let totalPointsGained = 0;

      wrongSupportingPlayers.forEach(p => {
        totalPointsGained += p.points;
        p.isEliminated = true;
        eliminatedPlayers.add(p.id);
        activePlayers.set(p.id, p);

        console.log(`Supporting player ${p.name} is eliminated.`);
        io.emit('player-eliminated', p);
      });
      if(mainPlayer){
        mainPlayer.points += totalPointsGained;
        activePlayers.set(mainPlayerId, mainPlayer);
      }
    } else {
      if(mainPlayer){
        mainPlayer.isEliminated = true;
        mainPlayer.isMainPlayer = false;
        eliminatedPlayers.add(mainPlayerId);
        activePlayers.set(mainPlayerId, mainPlayer);
        console.log(`Main player ${mainPlayer.name} is eliminated.`);

        const playerToEmit = {
          id: mainPlayer.id,
          name: mainPlayer.name,
          points: mainPlayer.points,
          isHostPlayer: mainPlayer.isHostPlayer,
          isMainPlayer: false,           // Explicitly false
          isEliminated: true,            // Explicitly true
          joinedAt: mainPlayer.joinedAt
        };
        io.emit('player-eliminated', playerToEmit);

        mainPlayerId = null;

        const wrongSupportingPlayers = supportingPlayers.filter(p => {
          const answer = playerAnswers.get(p.id);
          return !answer || !answer.isCorrect;
        });

        wrongSupportingPlayers.forEach(player => {
          player.isEliminated = true;
          eliminatedPlayers.add(player.id);
          activePlayers.set(player.id, player);
          console.log(`Supporting player ${player.name} is eliminated.`);

          io.emit('player-eliminated', player);
        });

        const correctSupportingPlayers = supportingPlayers.filter(p => {
          const answer = playerAnswers.get(p.id);
          return answer && answer.isCorrect;
        });

        if(correctSupportingPlayers.length > 0){
          const pointsPerPlayer = Math.floor(mainPlayer.points / correctSupportingPlayers.length);
          
          correctSupportingPlayers.forEach(player =>{
            player.points += pointsPerPlayer;
            activePlayers.set(player.id, player);
          });

          mainPlayer.points = 0;
          activePlayers.set(mainPlayer.id, mainPlayer);
        }
      }
    }
  }

  const result = {
    correctAnswer: currentQuestion.answer,
    explanation: currentQuestion.explanation,
    scores: Array.from(activePlayers.values()).map(p =>({
      id: p.id,
      name: p.name,
      points: p.points,
      isMainPlayer: p.id === mainPlayerId,
      isEliminated: p.isEliminated,
      answered: playerAnswers.get(p.id)?.answer || 'N/A',
      isCorrect: playerAnswers.get(p.id)?.isCorrect
    }))
  };

  io.emit('question-ended', result);
  const activeSupportingPlayers = Array.from(activePlayers.values()).filter(p => !p.isMainPlayer && !p.isEliminated);

  //case 1: main thắng, không còn ai khác
  if(mainPlayerId && activeSupportingPlayers.length === 0) {
    //nước mắt anh rơi trò chơi kết thúc
    const mainPlayer = activePlayers.get(mainPlayerId);

    usedQuestion.clear();
    activePlayers.clear();
    playerNames.clear();
    eliminatedPlayers.clear();
    playerAnswers.clear();
    firstCorrectAnswerPlayerId = null;

    console.log(`Main player ${mainPlayer.name} wins as the last one standing!`);
    setTimeout(() => {
      gameState = 'waiting';
      const finalScores = Array.from(activePlayers.values()).sort((a, b) => b.points - a.points);

      io.emit('game-ended', {
        message: `Game over! Main player ${mainPlayer.name} wins as the last one standing.`,
        finalScores: finalScores,
        winner: mainPlayer
      });
    }, 10000);
    return;
  }
  //case 2: main thua, còn đúng 1 người
  if (!mainPlayerId && activeSupportingPlayers.length === 1 ){
    //nước mắt anh rơi trò chơi kết thúc
    const winner = activeSupportingPlayers[0];

    usedQuestion.clear();
    activePlayers.clear();
    playerNames.clear();
    eliminatedPlayers.clear();
    playerAnswers.clear();
    firstCorrectAnswerPlayerId = null;

    console.log(`${winner.name} is the last one standing.`);
    setTimeout(() => {
      gameState = 'waiting';
      const finalScores = Array.from(activePlayers.values()).sort((a, b) => b.points - a.points);

      io.emit('game-ended', {
        message: `Game over! ${winner.name} wins as the last supporting player.`,
        finalScores: finalScores,
        winner: winner
      });
    }, 10000);
    return;
  } 
  //case 3: thua cả lũ
  if (!mainPlayerId && activeSupportingPlayers.length === 0){
    //nước mắt anh rơi trò chơi kết thúc
    const allPlayers = Array.from(activePlayers.values());

    usedQuestion.clear();
    activePlayers.clear();
    playerNames.clear();
    eliminatedPlayers.clear();
    playerAnswers.clear();
    firstCorrectAnswerPlayerId = null;

    console.log('Game ended with no winner.');
    setTimeout(() => {
      gameState = 'waiting';
      const finalScores = allPlayers.sort((a, b) => b.points - a.points);

      io.emit('game-ended', {
        message: 'Game ended with no definite winner',
        finalScores: finalScores,
        winner: finalScores[0]
      });
    }, 10000);
    return;
  }
  //case 4: main thua, vẫn còn nhiều người chơi khác
  if (!mainPlayerId && activeSupportingPlayers.length > 1){
    console.log(`${activeSupportingPlayers.length} players remain. Next question will be used to find new main player.`);
    setTimeout(() => {
      activeSupportingPlayers.forEach(p => {
        p.isMainPlayer = false;
        activePlayers.set(p.id, p);
      });

      startNewQuestion('first-question');
    }, 7000);
    return;
  }
  //case 5: tiếp
  if (mainPlayerId && activeSupportingPlayers.length > 0) {
    const mainPlayer = activePlayers.get(mainPlayerId);
    console.log(`Game continue in 3 seconds. Main player: ${mainPlayer?.name}, Supporting players: ${activeSupportingPlayers.length}`);
    
    setTimeout(() => {
      gameState = 'main-game';
      startNewQuestion('main-game');
    }, 7000);
    return;
  }
  //nếu không bắt được case nào thì hủy game
  console.log('Undefined state reached. Ending the game');
  setTimeout(() => {
    gameState = 'waiting';
    const finalScores = Array.from(activePlayers.values()).sort((a, b) => b.points - a.points);
    const winner = finalScores[0];
    
    io.emit('game-ended', {
      message: 'Game ended unexpectedly.',
      finalScores: finalScores,
      winner: winner
    });
  }, 7000);
  return;
}

function selectNewHostPlayer(){
  const activePlayerList = Array.from(activePlayers.values()).filter(p => !p.isEliminated);
  if(activePlayerList.length === 0){
    hostPlayerId = null;
    return;
  }

  const newHost = activePlayerList[0];
  newHost.isHostPlayer = true;
  hostPlayerId = newHost.id;
  activePlayers.set(newHost.id, newHost);

  console.log(`Host player left. New host is ${newHost.name}.`);
  io.emit('new-host-player', {
    playerId: newHost.id,
    playerName: newHost.name
  });
}

function checkAllPlayersAnswered(){
  const activeNonEliminatedPlayer = Array.from(activePlayers.values()).filter(p => !p.isEliminated);
  if (activeNonEliminatedPlayer.length === 0) return false;
  return activeNonEliminatedPlayer.every(p => playerAnswers.has(p.id));
}

/* function handleMainPlayerAnswer(mainPlayer: any, isCorrect: boolean){
  console.log(`Main player ${mainPlayer.name} gave the ${isCorrect? 'correct' : 'wrong'} answer.`);
  const supportingPlayers = Array.from(activePlayers.values()).filter(p => !p.isMainPlayer && !p.isEliminated);

  if(isCorrect){
    const wrongSupportingPlayers = supportingPlayers.filter(p => {
      const answer = playerAnswers.get(p.id);
      return !answer || !answer.isCorrect;
    });

    wrongSupportingPlayers.forEach(player => {
      player.isEliminated = true;
      eliminatedPlayers.add(player.id);
      activePlayers.set(player.id, player);

      console.log(`Supporting player ${player.name} is eliminated.`);
      io.emit('player-eliminated', {
        id: player.id,
        name: player.name
      });
    });

    const pointsGained = wrongSupportingPlayers.length * 5;
    mainPlayer.points += pointsGained;
    activePlayers.set(mainPlayerId, mainPlayer);
  } else {
    mainPlayer.isEliminated = true;
    mainPlayer.isMainPlayer = false;
    eliminatedPlayers.add(mainPlayerId);
    activePlayers.set(mainPlayerId, mainPlayer);

    console.log(`Main player ${mainPlayer.name} is eliminated.`);
    io.emit('player-eliminated', {
      id: mainPlayerId,
      name: mainPlayer.name
    });

    mainPlayerId = null;

    const wrongSupportingPlayers = supportingPlayers.filter(p => {
      const answer = playerAnswers.get(p.id);
      return !answer || !answer.isCorrect;
    });

    wrongSupportingPlayers.forEach(player => {
      player.isEliminated = true;
      eliminatedPlayers.add(player.id);
      activePlayers.set(player.id, player);

      console.log(`Supporting player ${player.name} is eliminated.`);
      io.emit('player-eliminated', {
        id: player.id,
        name: player.name
      });
    });

    const correctSupportingPlayers = supportingPlayers.filter(p => {
      const answer = playerAnswers.get(p.id);
      return answer && answer.isCorrect;
    });

    if(correctSupportingPlayers.length > 0){
      const pointsPerPlayer = Math.floor(mainPlayer.points / correctSupportingPlayers.length);
      
      correctSupportingPlayers.forEach(player =>{
        player.points += pointsPerPlayer;
        activePlayers.set(player.id, player);
      });

      mainPlayer.points = 0;
      activePlayers.set(mainPlayer.id, mainPlayer);
    }
  }
} */