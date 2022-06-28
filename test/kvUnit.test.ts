import test from 'ava'
import { WorkersKv } from '../src/index.js'
import { CustomError } from '../src/util.js'

const CF_EMAIL = process.env["CF_EMAIL"]
const CF_ACCOUNT_ID = process.env["CF_ACCOUNT_ID"]
const CF_GLOBAL_API_KEY = process.env["CF_GLOBAL_API_KEY"]

const cfWorkers = new WorkersKv(CF_EMAIL!, CF_ACCOUNT_ID!, CF_GLOBAL_API_KEY!);


const listNamespacesTest = () => {
    test("List Namespaces - Without URL parameters", async t =>{
        const req = await cfWorkers.listNamespaces()
        req.forEach((obj)=>{
            t.deepEqual(Object.keys(obj), ["id", "title", "supports_url_encoding"])
        })
    })
    
    test("List Namespaces - With URL parameters", async t =>{
        const req = await cfWorkers.listNamespaces({direction: "asc"})
        req.forEach((obj)=>{
            t.deepEqual(Object.keys(obj), ["id", "title", "supports_url_encoding"])
        })
    })
}

const createNamespace = () => {
    const namespaceName = "tempDb"
    test("Create a namespace", async t => {
        const req = await cfWorkers.createNamespace({title: namespaceName})
        t.deepEqual(req, ["id", "title", "supports_url_encoding"])
    })
}

export const createTempNamespace = async (namespaceName: string) => {
    return (await cfWorkers.createNamespace({title: namespaceName})).id
}

export const removeTempNamespace = async (namespaceId: string) => {
    await cfWorkers.removeNamespace({namespaceId: namespaceId!})
}



const removeNamespace = () => {
    const namespaceName = "removeNamespace"
    let namespaceId: string | null = null
    test.before("Create a temp namespace for test purpose", async() => {
        namespaceId = await createTempNamespace(namespaceName)
    })
    test("Remove a namespace - With existed namespace", async t => {
        const namespaceId = "abc"
        const req = await cfWorkers.removeNamespace({namespaceId: namespaceId})
        t.is(req, true)
    })
    test.after("Remove the temp namespace", async() => {
        await removeTempNamespace(namespaceId!)
    })

    test("Remove a namespace - With non existed namespace", async t =>{
        const namespaceId = "abc" //A namespace id that is not existed on Cloudflare KV
        
         await t.throwsAsync(async ()=>{
            const req = await cfWorkers.removeNamespace({namespaceId: namespaceId})
        }, {instanceOf: CustomError, name:"Failed to Remove a namespace"})
    })
}

const renameNamespace = () => {
    const namespaceName = "removeNamespace"
    let namespaceId: string | null = null
    const namespaceNewName = "newNamespaceName"
    test.before("Create a temp namespace for test purpose", async() => {
        namespaceId = await createTempNamespace(namespaceName)
    })
    test("Rename a namespace - With existed namespace Id", async t => {
        const namespaceId = "abc"

        const req = await cfWorkers.renameNamespace({namespaceId: namespaceId}, {title: namespaceNewName})
        t.is(req, true)
    })
    test.after("Remove the temp namespace", async() => {
        await removeTempNamespace(namespaceId!)
    })
    
    test("Rename a namespace - With non existed namespace Id", async t=>{
        const namespaceId = "bbc" //A namespace id that is not existed on Cloudflare KV
        
        await t.throwsAsync(async ()=>{
            const req = await cfWorkers.renameNamespace({namespaceId: namespaceId}, {title: namespaceNewName})
        }, {instanceOf: CustomError, name:"Failed to Rename a namespace"})
    
    })
}

const listNamespaceKeys = () => {
    const namespaceName = "removeNamespace"
    let namespaceId: string | null = null
    const namespaceNewName = "newNamespaceName"
    test.before("Create a temp namespace for test purpose", async() => {
        namespaceId = await createTempNamespace(namespaceName)
    })
    test
    test("List a namespace's keys - Without URL parameters", async t => {
        const req = await cfWorkers.listNamespaceKeys({namespaceId: namespaceId!})

        t.deepEqual(Object.keys(req), ["result", "result_info"])
    
        req.result.forEach((obj)=>{
            t.is(Object.keys(obj).includes("name"), true)
        })

        t.deepEqual(Object.keys(req.result_info), ["count", "cursor"])
    })

    test("List a namespace's keys - With URL parameters", async t => {
        const req = await cfWorkers.listNamespaceKeys({namespaceId: namespaceId!}, {limit: 50})

        t.deepEqual(Object.keys(req), ["result", "result_info"])
    
        req.result.forEach((obj)=>{
            t.is(Object.keys(obj).includes("name"), true)
        })

        t.deepEqual(Object.keys(req.result_info), ["count", "cursor"])
    })
    test.after("Remove the temp namespace", async() => {
        await removeTempNamespace(namespaceId!)
    })
}

