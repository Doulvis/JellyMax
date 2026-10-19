// Intégration Android (Capacitor) : chargée uniquement dans le build `--mode android`.
import { App } from '@capacitor/app';
import { registerPlugin } from '@capacitor/core';
import { native } from './platform';

/** Plugin natif de l'application (android/app/src/main/java/app/jellymax/mobile/JellyMaxSystemPlugin.java). */
interface JellyMaxSystem {
  setPlayback(options: { active: boolean }): Promise<void>;
}
const system = registerPlugin<JellyMaxSystem>('JellyMaxSystem');

export function initAndroid() {
  native.setPlayback = (active) => {
    system.setPlayback({ active }).catch(() => {});
  };
  native.exit = () => {
    App.exitApp().catch(() => {});
  };

  // Bouton "Retour" d'Android : transmis comme la touche "Précédent" d'un clavier, déjà gérée partout
  // (fermeture des menus et panneaux, sortie du lecteur, page précédente, sortie de l'application).
  App.addListener('backButton', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'GoBack', bubbles: true, cancelable: true }));
  });
}
