import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import App from './src/App';
import { installGlobalErrorHandler } from './src/services/crashLog';

installGlobalErrorHandler();

registerRootComponent(App);
