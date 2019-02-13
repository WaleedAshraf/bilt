'use strict'
const {promisify: p} = require('util')
const os = require('os')
const fs = require('fs')
const path = require('path')
const {dockerComposeTool, getAddressForService} = require('docker-compose-mocha')
const RegistryClient = require('npm-registry-client')
const hostAgentService = require('@bilt/host-agent')
const pluginImport = require('plugin-import')
const npmCommanderService = require('@bilt/npm-commander')

function setup(before, after) {
  const pathToCompose = path.join(__dirname, 'docker-compose.yml')

  const envName = dockerComposeTool(before, after, pathToCompose, {
    shouldPullImages: (process.env.NODE_ENV || 'development') !== 'development',
    brutallyKill: true,
  })

  let pimport
  let hostAgent
  let agentInstance
  let npmCommander
  let npmCommanderSetup
  before(async () => {
    pimport = await createPimport(envName, pathToCompose)

    hostAgent = await pimport('host-agent')
    agentInstance = await hostAgent.acquireInstanceForJob()

    npmCommander = await pimport('npm-commander')
    npmCommanderSetup = await npmCommander.setup({agentInstance})
  })

  return {
    pimport: () => pimport,
    agent: () => hostAgent,
    agentInstance: () => agentInstance,
    npmCommander: () => npmCommander,
    npmCommanderSetup: () => npmCommanderSetup,
    async setupPackage(packageDir, {shouldPublish = true}) {
      const dir = await createPackage(packageDir)
      const packageJson = JSON.parse(await p(fs.readFile)(path.join(dir, 'package.json')))

      if (shouldPublish) {
        await publishPackage(dir, hostAgent, agentInstance, npmCommander, npmCommanderSetup)
      }

      return {dir, packageJson}
    },
  }
}

async function createPackage(packageDir) {
  const tmpDir = await p(fs.mkdtemp)(os.tmpdir() + '/')

  await p(fs.copyFile)(
    path.join(__dirname, packageDir, 'package.json'),
    path.join(tmpDir, 'package.json'),
  )

  return tmpDir
}

async function createPimport(envName, pathToCompose) {
  const npmRegistryAddress = await getAddressForService(
    envName,
    pathToCompose,
    'npm-registry',
    4873,
  )
  const registryClient = new RegistryClient()
  const npmToken = (await p(registryClient.adduser.bind(registryClient))(
    `http://${npmRegistryAddress}/`,
    {
      auth: {
        username: 'npm-user',
        email: 'gil@tayar.org',
        password: 'npm-user-password',
      },
    },
  )).token
  const pimport = await pluginImport(
    [
      {
        'host-agent': hostAgentService,
        'npm-commander': {
          package: npmCommanderService,
          npmRegistry: `http://${npmRegistryAddress}`,
          npmAuthenticationLine: `//${npmRegistryAddress}/:_authToken="${npmToken}"`,
        },
      },
    ],
    {useThisRequire: require},
  )
  return pimport
}

async function publishPackage(dir, agent, agentInstance, npmCommander, npmCommanderSetup) {
  await agent.executeCommand(
    npmCommander.transformAgentCommand(
      {
        agentInstance,
        command: ['npm', 'publish'],
        cwd: dir,
      },
      {setup: npmCommanderSetup},
    ),
  )
}

module.exports = setup