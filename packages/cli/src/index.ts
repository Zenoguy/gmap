#!/usr/bin/env node
import { program } from 'commander';

program
  .name('gmap')
  .description('codebase graph mapper — understand your code at the speed AI generates it')
  .version('0.1.0');

// Commands registered here in M1+
// program.addCommand(scanCommand);
// program.addCommand(serveCommand);

program.parse(process.argv);
