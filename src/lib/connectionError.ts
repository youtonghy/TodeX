export enum ConnectionErrorType {
  NETWORK_OFFLINE = 'NETWORK_OFFLINE',
  SERVER_UNREACHABLE = 'SERVER_UNREACHABLE',
  TIMEOUT = 'TIMEOUT',
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  SERVER_ERROR = 'SERVER_ERROR',
  PROTOCOL_ERROR = 'PROTOCOL_ERROR',
  MESSAGE_TOO_LARGE = 'MESSAGE_TOO_LARGE',
  HEARTBEAT_TIMEOUT = 'HEARTBEAT_TIMEOUT',
}

export class ConnectionError extends Error {
  constructor(
    public type: ConnectionErrorType,
    public userMessage: string,
    public technicalDetails: string,
    public retryable: boolean = false
  ) {
    super(userMessage);
    this.name = 'ConnectionError';
  }

  static networkOffline(details: string): ConnectionError {
    return new ConnectionError(
      ConnectionErrorType.NETWORK_OFFLINE,
      '网络连接失败，请检查网络设置',
      details,
      true
    );
  }

  static timeout(details: string): ConnectionError {
    return new ConnectionError(
      ConnectionErrorType.TIMEOUT,
      '连接超时，请检查网络状况',
      details,
      true
    );
  }

  static connectionTimeout(): ConnectionError {
    return new ConnectionError(
      ConnectionErrorType.CONNECTION_TIMEOUT,
      'WebSocket连接超时，请稍后重试',
      'WebSocket connection timeout after 10s',
      true
    );
  }

  static authenticationFailed(status: number): ConnectionError {
    return new ConnectionError(
      ConnectionErrorType.AUTHENTICATION_FAILED,
      '身份验证失败，请检查连接设置',
      `HTTP ${status}`,
      false
    );
  }

  static serverError(status: number): ConnectionError {
    return new ConnectionError(
      ConnectionErrorType.SERVER_ERROR,
      '服务器暂时不可用，请稍后重试',
      `HTTP ${status}`,
      true
    );
  }

  static protocolError(status: number): ConnectionError {
    return new ConnectionError(
      ConnectionErrorType.PROTOCOL_ERROR,
      '请求失败，请检查网络连接',
      `HTTP ${status}`,
      true
    );
  }

  static messageTooLarge(size: number, max: number): ConnectionError {
    return new ConnectionError(
      ConnectionErrorType.MESSAGE_TOO_LARGE,
      '消息过大，无法发送',
      `Message size ${size} exceeds limit ${max}`,
      false
    );
  }

  static heartbeatTimeout(): ConnectionError {
    return new ConnectionError(
      ConnectionErrorType.HEARTBEAT_TIMEOUT,
      '连接已断开，正在尝试重连',
      'Missed heartbeats',
      true
    );
  }
}
