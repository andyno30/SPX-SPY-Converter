import {fileURLToPath} from 'node:url';
// Local playtest entry only. Vercel builds the parent app, whose gameplay gate stays closed.
export default {basePath:'/game', poweredByHeader:false, reactStrictMode:true,agentRules:false,
  outputFileTracingRoot:fileURLToPath(new URL('..',import.meta.url)),
  allowedDevOrigins:['127.0.0.1'],
  webpack(config){config.resolve.extensionAlias={...config.resolve.extensionAlias,'.js':['.ts','.tsx','.js']};return config;},
};
