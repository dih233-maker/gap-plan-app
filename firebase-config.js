// Gap 90 Day Plan · gap-plan-app (Web)
// Project: gap-90-day-plan

export const firebaseConfig = {
  apiKey: 'AIzaSyBOWqClUaUVTd5VOyFkgDiw9IRSZFUD4jw',
  authDomain: 'gap-90-day-plan.firebaseapp.com',
  projectId: 'gap-90-day-plan',
  storageBucket: 'gap-90-day-plan.firebasestorage.app',
  messagingSenderId: '503157938209',
  appId: '1:503157938209:web:6605643fe630f772d7ab60',
  measurementId: 'G-QYFE2WEJ1H',
};

export function isFirebaseConfigured() {
  return firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('YOUR_');
}
