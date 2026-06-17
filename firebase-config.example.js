// Copy this file to firebase-config.js and paste values from:
// npx -y firebase-tools@latest apps:sdkconfig WEB <APP_ID> --project <PROJECT_ID>

export const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.firebasestorage.app',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

export function isFirebaseConfigured() {
  return firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('YOUR_');
}
