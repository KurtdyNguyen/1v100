import { useEffect, useState, useCallback, useRef } from "react";
import { SocketService } from "./services/socket";
import type { Player } from "./types/types";
import "./App.css";

function App() {
  const [socketService] = useState(() => new SocketService());

  //player
  const [players, setPlayers] = useState<Player[]>([]);
  const [playerName, setPlayerName] = useState("");
  const [yourPlayer, setYourPlayer] = useState<Player | null>(null);
  const [socketId, setSocketId] = useState("");
  const [message, setMessage] = useState("");

  //game
  const [gameState, setGameState] = useState<
    "waiting" | "first-question" | "main-game" | "result"
  >("waiting");
  const [currentQuestion, setCurrentQuestion] = useState<any>(null);
  const [mainPlayerId, setMainPlayerId] = useState<string | null>(null);
  const [hostPlayerId, setHostPlayerId] = useState<string | null>(null);

  //question
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [questionResult, setQuestionResult] = useState<any>(null);
  const [eliminatedPlayers, setEliminatedPlayers] = useState<Set<string>>(
    new Set()
  );

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleJoinSuccess = useCallback((playerData: Player) => {
    console.log("Welcome ", playerData);
    setYourPlayer(playerData);
    //kiểm tra trùng lặp
    setPlayers((prev) => {
      if (!prev.some((p) => p.id === playerData.id)) {
        return [...prev, playerData];
      }
      return prev;
    });
    setMessage(`Joined as ${playerData.name}`);

    if (playerData.isHostPlayer) {
      setHostPlayerId(playerData.id);
    }
  }, []);

  const handlePlayerJoined = useCallback((newPlayer: Player) => {
    console.log("Someone else joined: ", newPlayer);
    setPlayers((prev) => {
      if (!prev.some((p) => p.id === newPlayer.id)) {
        return [...prev, newPlayer];
      }
      return prev;
    });
    setMessage(`${newPlayer.name} joined the lobby`);
  }, []);

  const handlePlayerListUpdate = useCallback((allPlayers: Player[]) => {
    console.log("Player list: ", allPlayers);
    setPlayers(allPlayers);

    const socketId = socketService.getSocket()?.id;
    if (socketId) {
      const me = allPlayers.find((p) => p.id === socketId);
      if (me) {
        setYourPlayer(me);
      }
    }
    const host = allPlayers.find((p) => p.isHostPlayer);
    if (host) {
      setHostPlayerId(host.id);
    }
  }, []);

  const handlePlayerLeft = useCallback((playerLeft: Player) => {
    console.log("Player left: ", playerLeft);
    setPlayers((prev) => prev.filter((p) => p.id !== playerLeft.id));
    setMessage(`${playerLeft.name} left the lobby`);
  }, []);

  const handleError = useCallback((errorMessage: string) => {
    console.error("Socket error:", errorMessage);
    setMessage(`Error: ${errorMessage}`);
  }, []);

  const handleJoinError = useCallback((errorData: { message: string }) => {
    console.error("Join error:", errorData.message);
    setMessage(`Cannot join: ${errorData.message}`);
  }, []);

  const handleGameStarted = useCallback(() => {
    console.log("Game started!");
    setGameState("first-question");
    setMessage("Game started!");

    setSelectedAnswer(null);
    setHasAnswered(false);
    setQuestionResult(null);
  }, []);

  const handleNewQuestion = useCallback((questionData: any) => {
    console.log("New question: ", questionData);

    setCurrentQuestion(questionData);
    setGameState(questionData.phase);
    setMainPlayerId(questionData.mainPlayerId);
    setMessage(`Question time...`);

    setSelectedAnswer(null);
    setHasAnswered(false);
    setQuestionResult(null);

    setTimeLeft(questionData.timeLimit);
    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const handleGameEnded = useCallback((result: any) => {
    console.log("Game over: ", result);
    setMessage(result.message);
    setGameState("waiting");

    if (result.winner) {
      setMessage(
        `Game over.\n\nWinner: ${result.winner.name} - Points: ${result.winner.points}\n${result.winner.message}`
      );
    } else {
      setMessage(`Game over.\n\n${result.winnner.message}`);
    }

    setCurrentQuestion(null);
    setMainPlayerId(null);
    setQuestionResult(null);
    setEliminatedPlayers(new Set());
    setPlayers([]);
    setYourPlayer(null);
  }, []);

  const handleNewHostPlayer = useCallback(
    (data: { playerId: string; playerName: string }) => {
      console.log("New host player picked: ", data);
      setHostPlayerId(data.playerId);
      setMessage(`${data.playerName} is the new host.`);

      setPlayers((prev) =>
        prev.map((p) => ({
          ...p,
          isHostPlayer: p.id === data.playerId,
        }))
      );

      if (yourPlayer?.id === data.playerId) {
        setYourPlayer((prev) =>
          prev ? { ...prev, isHostPlayer: true } : null
        );
      }
    },
    []
  );

  const handlePlayerEliminated = useCallback((eliminatedPlayer: Player) => {
    console.log("Player eliminated: ", eliminatedPlayer);
    setEliminatedPlayers((prev) => new Set([...prev, eliminatedPlayer.id]));

    setPlayers((prev) =>
      prev.map((p) =>
        p.id === eliminatedPlayer.id ? { ...p, isEliminated: true } : p
      )
    );

    setYourPlayer((prevPlayer) => {
      if (prevPlayer?.id === eliminatedPlayer.id) {
        console.log("I've been eliminated. Updating yourPlayer...");
        const updated = { ...prevPlayer, isEliminated: true };
        console.log("Updated yourPlayer:", updated);
        return updated;
      }
      return prevPlayer;
    });

    setMessage(`${eliminatedPlayer.name} was eliminated!`);
  }, []);

  const handleQuestionEnded = useCallback((result: any) => {
    console.log("Question ended with result:", result);
    setQuestionResult(result);
    setMessage("Question results are in!");

    if (result.scores) {
      setPlayers((prev) =>
        prev.map((player) => {
          const resultScore = result.scores.find(
            (s: any) => s.id === player.id
          );
          if (resultScore) {
            return {
              ...player,
              points: resultScore.points,
              isEliminated: resultScore.isEliminated,
              isMainPlayer: resultScore.isMainPlayer,
            };
          }
          return player;
        })
      );
    }

    if (yourPlayer && result.scores) {
      const yourResult = result.scores.find((s: any) => s.id === yourPlayer.id);
      if (yourResult) {
        setYourPlayer((prev) =>
          prev
            ? {
                ...prev,
                points: yourResult.points,
                isEliminated: yourResult.isEliminated,
                isMainPlayer: yourResult.isMainPlayer,
              }
            : null
        );
      }
    }
  }, []);

  const handleFirstCorrectAnswer = useCallback(
    (data: { playerId: string; playerName: string }) => {
      console.log("First correct answer:", data);
      setMessage(
        `${data.playerName} gave the first correct answer and will become the main player!`
      );
    },
    []
  );

  const handleMainPlayerSelected = useCallback(
    (data: { playerId: string; playerName: string }) => {
      console.log("Main player selected:", data);
      setMainPlayerId(data.playerId);
      setMessage(`${data.playerName} is now the main player.`);

      setPlayers((prev) =>
        prev.map((player) => ({
          ...player,
          isMainPlayer: player.id === data.playerId,
        }))
      );

      if (yourPlayer?.id === data.playerId) {
        setYourPlayer((prev) =>
          prev ? { ...prev, isMainPlayer: true } : null
        );
      }
    },
    []
  );

  useEffect(() => {
    const socket = socketService.connect();

    socket?.on("connect", () => {
      setSocketId(socket.id || "");
      setMessage("Connected to server");
    });

    socketService.on("join-success", handleJoinSuccess);
    socketService.on("player-joined", handlePlayerJoined);
    socketService.on("player-list-update", handlePlayerListUpdate);
    socketService.on("player-left", handlePlayerLeft);
    socketService.on("error", handleError);
    socketService.on("join-error", handleJoinError);
    socketService.on("start-game", handleGameStarted);
    socketService.on("new-question", handleNewQuestion);
    socketService.on("game-ended", handleGameEnded);
    socketService.on("new-host-player", handleNewHostPlayer);
    socketService.on("player-eliminated", handlePlayerEliminated);
    socketService.on("question-ended", handleQuestionEnded);
    socketService.on("first-correct-answer", handleFirstCorrectAnswer);
    socketService.on("main-player-selected", handleMainPlayerSelected);

    return () => {
      socketService.off("join-success");
      socketService.off("player-joined");
      socketService.off("player-list-update");
      socketService.off("player-left");
      socketService.off("error");
      socketService.off("join-error");
      socketService.off("start-game");
      socketService.off("new-question");
      socketService.off("game-ended");
      socketService.off("new-host-player");
      socketService.off("player-eliminated");
      socketService.off("question-ended");
      socketService.off("first-correct-answer");
      socketService.off("main-player-selected");

      if (timerRef.current) clearInterval(timerRef.current);
      socketService.disconnect();
    };
  }, [
    handleJoinSuccess,
    handlePlayerJoined,
    handlePlayerListUpdate,
    handlePlayerLeft,
    handleError,
    handleJoinError,
    handleGameStarted,
    handleGameEnded,
    handlePlayerEliminated,
    handleQuestionEnded,
    handleFirstCorrectAnswer,
    handleMainPlayerSelected,
  ]);

  const handleJoin = () => {
    if (playerName.trim()) {
      setMessage("Joining game...");
      socketService.joinGame(playerName);
    } else {
      setMessage("Enter a name!");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleJoin();
    }
  };

  const handleStartGame = () => {
    console.log("\t***Start game clicked***");
    console.log("Your ID:", yourPlayer?.id);
    console.log("Host ID:", hostPlayerId);
    console.log("Are you host?", yourPlayer?.id === hostPlayerId);

    if (yourPlayer?.id === hostPlayerId) {
      console.log("Emitting start-game event");
      socketService.getSocket()?.emit("start-game");
      setMessage("Game starting...");
    } else {
      setMessage("Only host can start the game");
    }
  };

  const handleAnswer = (answer: string) => {
    if (yourPlayer?.isEliminated) {
      setMessage("You are eliminated. Tough luck.");
      return;
    }
    if (hasAnswered || !currentQuestion || !socketService.getSocket()) return;

    setSelectedAnswer(answer);
    setHasAnswered(true);

    socketService.getSocket()?.emit("player-answer", { answer });
    setMessage(`Your answer: ${answer}`);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return (
    <div className="App">
      <h1>1v100</h1>

      <div className="status-box">
        <p>Status: {socketId ? "Connected" : "Disconnected"}</p>
        <p>Game State: {gameState}</p>
        <p>Message: {message}</p>
        {mainPlayerId && (
          <p>Main Player: {players.find((p) => p.id === mainPlayerId)?.name}</p>
        )}
      </div>
      {!yourPlayer ? (
        <div className="join-section">
          <input
            type="text"
            placeholder="Enter your name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            onKeyDown={handleKeyPress}
          />
          <button onClick={handleJoin} disabled={!playerName.trim()}>
            Join Game
          </button>
        </div>
      ) : (
        <>
          {yourPlayer?.isHostPlayer &&
            gameState === "waiting" &&
            players.length >= 2 && (
              <div className="start-game">
                <button onClick={handleStartGame}>
                  Start Game ({players.length}/100)
                </button>
              </div>
            )}

          {currentQuestion && !yourPlayer?.isEliminated && (
            <div className="question-box">
              <h3>Question: {currentQuestion.question}</h3>
              <p>
                <strong>Time limit:</strong> {timeLeft}s /{" "}
                {currentQuestion.timeLimit}s
              </p>
              <p>
                <strong>Phase:</strong> {currentQuestion.phase}
              </p>

              <div className="options">
                {currentQuestion.options?.map((opt: any) => (
                  <button
                    key={opt.abcd}
                    onClick={() => handleAnswer(opt.abcd)}
                    disabled={hasAnswered}
                    className={selectedAnswer === opt.abcd ? "selected" : ""}
                  >
                    {opt.abcd}: {opt.text}
                  </button>
                ))}
              </div>

              {hasAnswered && <p>Answer submitted. Waiting for results...</p>}
            </div>
          )}

          {yourPlayer?.isEliminated && (
            <div>
              <h3>You are eliminated! Tough luck.</h3>
              <p>
                You can no longer answer questions. Watch the game continue
                below.
              </p>
            </div>
          )}

          {questionResult && (
            <div className="result-box">
              <h3>Question Results</h3>
              <p>
                <strong>Correct Answer:</strong> {questionResult.correctAnswer}
              </p>
              <p>
                <strong>Explanation:</strong> {questionResult.explanation}
              </p>

              <h4>Your Result:</h4>
              {questionResult.scores?.find(
                (s: any) => s.id === yourPlayer?.id
              ) ? (
                <div>
                  <p>
                    Your answer:{" "}
                    {
                      questionResult.scores.find(
                        (s: any) => s.id === yourPlayer?.id
                      ).answered
                    }
                  </p>
                  <p>
                    Correct:{" "}
                    {questionResult.scores.find(
                      (s: any) => s.id === yourPlayer?.id
                    ).isCorrect
                      ? "correct"
                      : "wrong"}
                  </p>
                </div>
              ) : (
                <p>No answer submitted</p>
              )}
            </div>
          )}

          <div className="player-list-box">
            <h3>
              You: {yourPlayer.name}
              {yourPlayer.isHostPlayer && " (Host)"}
              {yourPlayer.id === mainPlayerId && " (Main)"}
              {yourPlayer.isEliminated && " (Eliminated)"}
            </h3>

            <h4>Players ({players.length})</h4>
            {players.length === 0 ? (
              <p>No players yet</p>
            ) : (
              <ul>
                {players.map((player) => (
                  <li
                    key={player.id}
                    className={`
                      ${player.id === yourPlayer?.id ? "(You)" : ""}
                      ${eliminatedPlayers.has(player.id) ? "(Eliminated)" : ""}
                    `}
                  >
                    {player.name} - {player.points} points
                    {player.id === yourPlayer?.id && " (You)"}
                    {player.isHostPlayer && " (Host)"}
                    {player.id === mainPlayerId && " (Main)"}
                    {eliminatedPlayers.has(player.id) && " (Eliminated)"}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default App;
