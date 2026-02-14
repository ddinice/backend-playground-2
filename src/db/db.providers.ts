import { dbProvider } from './db.datasource';

export const dbProviders = [
  {
    provide: 'DATA_SOURCE',
    useFactory: async () => {
      if (!dbProvider.isInitialized) {
        await dbProvider.initialize();
      }
      return dbProvider;
    },
  },
];
