import { configure } from '@testing-library/react-native';

// Os testes montam o app inteiro sobre o núcleo real: a primeira tela de um cenário com
// lançamentos passa do segundo padrão de espera das consultas `findBy`.
configure({ asyncUtilTimeout: 5000 });
