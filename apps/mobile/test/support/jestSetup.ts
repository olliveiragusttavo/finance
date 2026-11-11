// Preparação de todo arquivo de teste do app: os módulos nativos que o Jest não tem.
import 'react-native-gesture-handler/jestSetup';
import type * as BottomSheetMock from './bottomSheetMock.tsx';

jest.mock('@gorhom/bottom-sheet', () => jest.requireActual<typeof BottomSheetMock>('./bottomSheetMock.tsx'));
