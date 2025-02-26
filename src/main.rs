use std::{
    collections::HashMap, env, fmt::Result, net::SocketAddr, sync::{Arc, Mutex}
};

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::{net::{TcpListener, TcpStream}, sync::broadcast};
use tokio_tungstenite::{accept_async, tungstenite::Message};

#[derive(Debug, Clone, Deserialize, Serialize)]
struct User {
    user_id: String,
    name: String,
    avatar: String,
    current_file: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct FileActivity {
    user_id: String,
    file_path: String,
    repo_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", content = "data")]
enum ClientMessage {
    Register(User),
    FileFocus { file_path: String, repo_id: String },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", content = "data")]
enum ServerMessage {
    UserUpdate(HashMap<String, User>),
    FileActivityUpdate(FileActivity),
}

struct AppState {
    active_users: Mutex<HashMap<String, User>>,
}

async fn handle_connection(
    ws_stream: tokio_tungstenite::WebSocketStream<TcpStream>,
    state: Arc<AppState>,
    tx: broadcast::Sender<ServerMessage>,
) {
    println!("New websocket connection");

    let (mut ws_sender, mut ws_recv) = ws_stream.split();
    let mut rx = tx.subscribe();

    let mut curr_user_id = None;

    let send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            let json = serde_json::to_string(&msg).unwrap();
            if ws_sender.send(Message::Text(json.into())).await.is_err() {
                break;
            }
        }
    });

    while let Some(res) = ws_recv.next().await {
        match res {
            Ok(msg) => {
                if let Message::Text(text) = msg {
                    if let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&text) {
                        match client_msg {
                            ClientMessage::Register(user) => {
                                println!("Reg {} ",  user.user_id.clone());
                                curr_user_id = Some(user.user_id.clone());

                                // Store users in active users
                                {
                                    let mut users = state.active_users.lock().unwrap();
                                    users.insert(user.user_id.clone(), user);
                                } // Scope should call drop on the mutex so it should unlock??? 

                                let users = state.active_users.lock().unwrap().clone();
                                let _ = tx.send(ServerMessage::UserUpdate(users));
                            }

                            ClientMessage::FileFocus { file_path, repo_id } => {
                                if let Some(ref user_id) = curr_user_id {
                                    {
                                        let mut users = state.active_users.lock().unwrap();
                                        if let Some(user) = users.get_mut(user_id) {
                                            user.current_file = Some(file_path.clone());
                                        }
                                    }

                                    println!("File focus {}", file_path.clone());
                                    let activity = FileActivity {
                                        user_id: user_id.clone(),
                                        file_path,
                                        repo_id,
                                    };

                                    let _ = tx.send(ServerMessage::FileActivityUpdate(activity));
                                }
                            }
                        }
                    }
                }
            }
            Err(_) => break,
        }
    }

    if let Some(user_id) = curr_user_id {
        {
            let mut users = state.active_users.lock().unwrap(); 
            users.remove(&user_id);
        } 
        
        let users = state.active_users.lock().unwrap().clone(); 
        let _ = tx.send(ServerMessage::UserUpdate(users)); 
    }

    send_task.abort();
    println!("websocket connection closed");
}


#[tokio::main] 
async fn main() -> Result {
    let addr = env::args()
        .nth(1)
        .unwrap_or_else(|| "127.0.0.1:3030".to_string());

    let addr = addr.parse::<SocketAddr>().unwrap();
    println!("Server running on {}", addr);

    let state = Arc::new(AppState{
        active_users: Mutex::new(HashMap::new()),
    });

    let (tx, _) = broadcast::channel::<ServerMessage>(100);
    let listener = TcpListener::bind(&addr).await.unwrap();

    while let Ok((stream, _)) = listener.accept().await {
        let ws_stream = accept_async(stream).await.expect("Failed to accept a websocket");
        let state_cl = Arc::clone(&state); 
        let tx_cl = tx.clone();

        tokio::spawn(async move {
            handle_connection(ws_stream, state_cl, tx_cl).await;
        });

    } 

    println!("Hello, world!");
    Ok(())
}
