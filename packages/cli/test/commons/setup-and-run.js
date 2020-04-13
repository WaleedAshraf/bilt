const {promisify} = require('util')
const path = require('path')
const {execFile} = require('child_process')
const {init} = require('@bilt/git-testkit')
const {startNpmRegistry} = require('@bilt/npm-testkit')
const {makeTemporaryDirectory, writeFile, sh} = require('@bilt/scripting-commons')
const cli = require('../../src/cli')

async function createAdepsBdepsCPackages(cwd, registry, base = '.') {
  await writeFile('.npmrc', `registry=${registry}\n`, {cwd})
  const {cPackageJson, bPackageJson} = await createPackages(
    cwd,
    registry,
    `${base}/a`,
    `${base}/b`,
    `${base}/c`,
  )
  return {cPackageJson, bPackageJson}
}

async function createPackages(cwd, registry, aPackageDir, bPackageDir, cPackageDir) {
  const aPackage = path.basename(aPackageDir)
  const bPackage = path.basename(bPackageDir)
  const cPackage = path.basename(cPackageDir)
  const build = `echo $(expr $(cat build-count) + 1) >build-count`
  await writeFile(
    [aPackageDir, 'package.json'],
    {
      name: `${aPackage}-package`,
      version: '1.0.0',
      dependencies: {[`${bPackage}-package`]: '^2.0.0'},
      scripts: {
        test: `cp node_modules/${bPackage}-package/package.json ./${bPackage}-package.json`,
        build,
      },
    },
    {cwd},
  )
  await writeFile([aPackageDir, 'build-count'], '0', {cwd})
  await writeFile([aPackageDir, '.npmrc'], `registry=${registry}\n`, {cwd})
  const bPackageJson = {
    name: `${bPackage}-package`,
    version: '2.0.0',
    dependencies: {[`${cPackage}-package`]: '^3.0.0'},
    scripts: {
      test: `cp node_modules/${cPackage}-package/package.json ./${cPackage}-package.json`,
      build,
    },
  }
  await writeFile([bPackageDir, 'package.json'], bPackageJson, {cwd})
  await writeFile([bPackageDir, '.npmrc'], `registry=${registry}\n`, {cwd})
  await writeFile([bPackageDir, 'build-count'], '0', {cwd})
  await sh('npm publish', {cwd: path.join(cwd, bPackageDir)})

  const cPackageJson = {name: `${cPackage}-package`, version: '3.0.0', scripts: {build}}
  await writeFile([cPackageDir, 'package.json'], cPackageJson, {cwd})
  await writeFile([cPackageDir, '.npmrc'], `registry=${registry}\n`, {cwd})
  await writeFile([cPackageDir, 'build-count'], '0', {cwd})
  await sh('npm publish', {cwd: path.join(cwd, cPackageDir)})
  return {cPackageJson, bPackageJson}
}

async function prepareGitAndNpm() {
  const cwd = await makeTemporaryDirectory()
  const pushTarget = await makeTemporaryDirectory()
  await init(pushTarget, {bare: true})
  await init(cwd, {origin: pushTarget})
  const {registry} = await startNpmRegistry()

  await writeFile('.npmrc', `registry=${registry}\n`, {cwd})
  await writeFile(['.biltrc.json'], {}, {cwd})
  return {registry, cwd, pushTarget}
}

/**
 * @param {string} cwd
 * @param {string} [message]
 * @param {string[]} [packages]
 * @param {string[]} [uptos]
 * @param {string[]} [moreArgs]
 */
async function runBuild(cwd, message, packages = undefined, uptos = undefined, moreArgs = []) {
  const currentDir = process.cwd()
  try {
    process.chdir(cwd)
    await cli([
      ...(packages && packages.length > 0 ? packages : []),
      '-m',
      message,
      ...(uptos && uptos.length > 0 ? ['--upto', ...uptos] : []),
      ...moreArgs,
    ])
  } finally {
    process.chdir(currentDir)
  }
}

/**
 * @param {string} cwd
 * @param {string} [message]
 * @param {string[]} [packages]
 * @param {string[]} [uptos]
 */
async function runBuildCli(cwd, message, packages = undefined, uptos = undefined) {
  const {stdout} = await promisify(execFile)(
    path.resolve(__dirname, '../../scripts/bilt.js'),
    [
      ...(packages && packages.length > 0 ? packages : []),
      '-m',
      message,
      ...(uptos && uptos.length > 0 ? ['--upto', ...uptos] : []),
    ],
    {cwd},
  )

  return stdout
}

module.exports = {
  prepareGitAndNpm,
  createAdepsBdepsCPackages,
  runBuild,
  runBuildCli,
  createPackages,
}
