# Firebase setup & security rules for VoxelCraft

VoxelCraft uses **Firebase Realtime Database** for global usernames and
multiplayer servers, with **Anonymous Authentication** (each browser gets a
stable anonymous account — that's why your username belongs to one browser).

## Setup (once)

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add project** (name it e.g. `voxelcraft`).
2. **Build → Authentication → Sign-in method → Anonymous → Enable.**
3. **Build → Realtime Database → Create database** (choose a region, start in locked mode).
4. **Project settings → Your apps → Web app (</>)** → register → copy the `firebaseConfig` object.
5. Paste it into `js/net/firebase-config.js` (replacing `null`), then rebuild `standalone.html` if you play from the double-click version.
6. In **Realtime Database → Rules**, paste the rules below and Publish.

## Database layout

```
usernames/<name>            { uid, name, created }          one entry per claimed name
servers/<serverId>          { name, mode, cheats, seed, creator, creatorName, created }
servers/<serverId>/players/<uid>   { name, x, y, z, yaw, pitch, skin, ts }   (presence)
servers/<serverId>/edits/<"x,y,z">   blockId                every placed/broken block
servers/<serverId>/chests/<"x,y,z">  [27 slots]             shared chest contents
servers/<serverId>/chat/<pushId>     { name, text, ts }
```

## Rules

```json
{
  "rules": {
    "usernames": {
      ".read": "auth != null",
      "$name": {
        // claim a free name, or update your own; never someone else's
        ".write": "auth != null && (!data.exists() || data.child('uid').val() === auth.uid)",
        ".validate": "newData.hasChildren(['uid','name']) && newData.child('uid').val() === auth.uid && newData.child('name').isString() && newData.child('name').val().length <= 16"
      }
    },

    "servers": {
      ".read": "auth != null",
      "$serverId": {
        // creating a server writes the whole object at once — allowed only
        // if the server doesn't exist yet and you list yourself as creator
        ".write": "auth != null && !data.exists() && newData.child('creator').val() === auth.uid",
        ".validate": "newData.hasChildren(['name','mode','seed','creator'])",
        // after creation, only the creator may change server settings
        "name":   { ".write": "auth != null && data.parent().child('creator').val() === auth.uid" },
        "mode":   { ".write": "auth != null && data.parent().child('creator').val() === auth.uid" },
        "cheats": { ".write": "auth != null && data.parent().child('creator').val() === auth.uid" },

        "players": {
          // you may only write your own presence entry
          "$uid": { ".write": "auth != null && $uid === auth.uid" }
        },

        "edits": {
          // any signed-in player may build/break on a server
          "$pos": { ".write": "auth != null", ".validate": "newData.isNumber()" }
        },

        "chests": {
          // shared chests: anyone in the server can put/take items
          "$pos": { ".write": "auth != null" }
        },

        "chat": {
          "$msgId": {
            // create new messages; anyone may DELETE a message once it is
            // older than 5 minutes (clients sweep expired chat automatically)
            ".write": "auth != null && (!data.exists() || (!newData.exists() && data.child('ts').val() < now - 300000))",
            ".validate": "newData.hasChildren(['name','text','ts']) && newData.child('text').isString() && newData.child('text').val().length <= 200 && newData.child('ts').isNumber()"
          }
        }
      }
    }
  }
}
```

## Notes

- **Cheats on servers:** enforced client-side — the server *creator* can always
  use commands; other players only when the server was created with
  "Allow cheats for everyone". (Real anti-cheat needs a real server; Firebase
  rules can't inspect gameplay.)
- **Usernames are per-browser:** anonymous auth means a different browser or
  cleared site data = a different account = the old name stays claimed by the
  old browser.
- Free-tier limits are fine for playing with friends; if a server grows stale
  you can delete it from the Firebase console (Realtime Database → data view).
