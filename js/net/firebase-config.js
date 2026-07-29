/**
 * Firebase configuration.
 *
 * Multiplayer + global usernames need YOUR Firebase project:
 *   1. Go to https://console.firebase.google.com → Add project
 *   2. Add a Web App → copy the firebaseConfig object it shows you
 *   3. Paste it below, replacing `null`
 *   4. In the console, enable: Authentication → Anonymous, and Realtime Database
 *   5. Set the database rules from firebase-rules.md
 *
 * While this is null, the game runs fully offline: usernames are only
 * checked locally and the Multiplayer screen explains what's missing.
 */
export const firebaseConfig = null;
/* Example shape:
export const firebaseConfig = {
  apiKey: "AIza....",
  authDomain: "voxelcraft-xxxxx.firebaseapp.com",
  databaseURL: "https://voxelcraft-xxxxx-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "voxelcraft-xxxxx",
  appId: "1:1234567890:web:abcdef",
};
*/
