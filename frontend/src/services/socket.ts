import { io, Socket } from 'socket.io-client';
import type { SocketEvents } from '../types/types';

const SOCKET_URL = 'http://localhost:3000';

class SocketService {
  socket: Socket | null = null;
  callbacks: Map<keyof SocketEvents, (data:any) => void> = new Map();
  
  connect() {
    this.socket = io(SOCKET_URL, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 1000,
    });

    this.setupEventListeners();
    return this.socket;
  }

  setupEventListeners() {
    if(!this.socket) return;

    this.socket.on('connect', () => {
      console.log('Connected to game server:', this.socket?.id);
    });

    this.socket.on('connect-error', (error) => {
      console.error('Connection failed:', error.message);
      this.triggerCallback('error', error.message);
    });

    const eventMap: Record<string, keyof SocketEvents> = {
      'join-success': 'join-success',
      'player-joined': 'player-joined',
      'player-list-update': 'player-list-update',
      'player-left': 'player-left',
      'join-error': 'join-error',
      'start-game': 'start-game',
      'new-question': 'new-question',
      'game-ended': 'game-ended',
      'new-host-player': 'new-host-player',
      'player-eliminated': 'player-eliminated',
      'question-ended': 'question-ended',
      'first-correct-answer': 'first-correct-answer',
      'main-player-selected': 'main-player-selected',
    };

    Object.entries(eventMap).forEach(([event, callbackKey]) => {
      this.socket?.on(event, (data) => {
        console.log(`${event}`, data);
        this.triggerCallback(callbackKey, data);
      }); 
    });
  }

  on<T extends keyof SocketEvents>(event: T, callback: SocketEvents[T]) {
    this.callbacks.set(event, callback as any);
  }

  off<T extends keyof SocketEvents>(event: T) {
    this.callbacks.delete(event);
  }

  triggerCallback(event: keyof SocketEvents, data: any){
    const callback = this.callbacks.get(event);
    if(callback){
      callback(data);
    }
  }
  
  joinGame(playerName: string) {
    if (!this.socket) {
      console.error('Socket not initialized!');
      return;
    }
    const cleanPlayerName = playerName.trim();
    console.log(`Attempting to join as ${cleanPlayerName}`);

    if(!this.socket.connected){
      console.log('Waiting for connection.');
      this.socket.once('connect', () => {
        this.socket?.emit('join-game', cleanPlayerName);
      });
    } else {
      this.socket.emit('join-game', cleanPlayerName);
    }
  }  
  
  getSocket() {
    return this.socket;
  }
  
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.callbacks.clear();
      console.log('Disconnected from server.');
    }
  }
}

export {SocketService};