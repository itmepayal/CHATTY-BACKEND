import fs from "fs";
import path from "path";

function getJsFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results = results.concat(getJsFiles(full));
    } else if (file.endsWith(".js")) {
      results.push(full);
    }
  }
  return results;
}

export function checkCircularDependencies(targetDir = "src") {
  const files = getJsFiles(targetDir);
  const graph = new Map();

  for (const f of files) {
    const content = fs.readFileSync(f, "utf8");
    const imports = [];
    const regex = /(?:import|from)\s+["\x27]([\.\/][^"\x27]+)["\x27]/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      let importPath = match[1];
      let resolved = path.resolve(path.dirname(f), importPath);
      if (!resolved.endsWith(".js")) {
        if (fs.existsSync(resolved + ".js")) resolved += ".js";
        else if (fs.existsSync(path.join(resolved, "index.js"))) resolved = path.join(resolved, "index.js");
      }
      if (fs.existsSync(resolved)) {
        imports.push(path.relative(".", resolved));
      }
    }
    graph.set(path.relative(".", f), imports);
  }

  const visited = new Set();
  const recStack = new Set();
  const cycles = [];

  function dfs(node, pathArr) {
    visited.add(node);
    recStack.add(node);

    const neighbors = graph.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...pathArr, neighbor]);
      } else if (recStack.has(neighbor)) {
        const cycleStart = pathArr.indexOf(neighbor);
        cycles.push([...pathArr.slice(cycleStart), neighbor]);
      }
    }
    recStack.delete(node);
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      dfs(node, [node]);
    }
  }

  return cycles;
}

if (process.argv[1] && process.argv[1].endsWith("check-circular.js")) {
  const cycles = checkCircularDependencies(process.argv[2] || "src");
  if (cycles.length === 0) {
    console.log("No circular dependencies found!");
    process.exit(0);
  } else {
    console.log(`Found ${cycles.length} circular dependencies:`);
    cycles.forEach((c) => console.log(" -> " + c.join(" -> ")));
    process.exit(0); // Informative
  }
}
