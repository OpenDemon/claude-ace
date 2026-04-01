import { MemoryTool } from '../src/memory/CrossProjectMemory.js';

async function runTest() {
  const memory = new MemoryTool();
  
  console.log('=== CrossProjectMemory Test ===\n');
  
  console.log('1. Learning a lesson from Project A...');
  const learnResult = await memory.execute({
    action: 'learn',
    tags: ['react', 'useEffect', 'infinite-loop'],
    description: 'Component re-renders infinitely because object reference in dependency array changes every render.',
    solution: 'Use useMemo to memoize the object, or move it outside the component if it does not depend on props/state.'
  });
  console.log(learnResult, '\n');
  
  console.log('2. Setting a user preference...');
  const prefResult = await memory.execute({
    action: 'set_pref',
    key: 'testing_framework',
    value: 'vitest'
  });
  console.log(prefResult, '\n');
  
  console.log('3. Recalling knowledge in Project B...');
  const recallResult = await memory.execute({
    action: 'recall',
    tags: ['react', 'useEffect']
  });
  console.log(recallResult, '\n');
  
  console.log('4. Checking user preferences...');
  const getPrefsResult = await memory.execute({
    action: 'get_prefs'
  });
  console.log(getPrefsResult, '\n');
}

runTest().catch(console.error);
