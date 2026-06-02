export interface WsEventPayload {
  channel: string;
  event: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface JoinRoomPayload {
  roomId: string;
  username: string;
}

export interface ChatMessagePayload {
  text: string;
  sender: string;
  id: string;
  timestamp: string;
}
