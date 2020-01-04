// apollo-serverモジュールを読み込む
const { ApolloServer } = require(`apollo-server-express`)
const express = require(`express`)
const expressPlayground = require(`graphql-playground-middleware-express`).default

const { GraphQLScalarType } = require(`graphql`)

const { readFileSync } = require(`fs`)

const typeDefs = readFileSync(`./typeDefs.graphql`, `UTF-8`)

const { MongoClient } = require(`mongodb`)
require(`dotenv`).config()

const fetch = require('node-fetch')

const lib = require('./lib')

// ユニークID
var _id = 0

var tags = [
    { "photoID": "1", "userID": "gPlake" },
    { "photoID": "2", "userID": "sSchmidt" },
    { "photoID": "2", "userID": "mHattrup" },
    { "photoID": "2", "userID": "gPlake" }
]

async function start() {
    const app = express()
    const MONGO_DB = process.env.DB_HOST
    let db

    const GITHUB_CLIENT_ID = process.env.CLIENT_ID
    const GITHUB_CLIENT_SECRET = process.env.CLIENT_SECRET

    const client = await MongoClient.connect(
        MONGO_DB,
        { useNewUrlParser: true }
    )
    db = client.db()
    
    const resolvers = {
        Query: {
            me: (parent, args, { currentUser }) => currentUser,
            totalPhotos: (parent, args, { db }) => 
                db.collection('photos').estimatedDocumentCount(),
            allPhotos: (parent, args, { db }) =>
                db.collection('photos').find().toArray(),
            totalUsers: (parent, args, { db }) =>
                db.collection('users').estimatedDocumentCount(),
            allUsers: (parent, args, { db }) =>
                db.collection('users').find().toArray()
        },
        Mutation: {
            async githubAuth(parent, { code }, { db }) {
                let {
                    message,
                    access_token,
                    avatar_url,
                    login,
                    name
                } = await lib.authorizeWithGithub({
                    client_id: GITHUB_CLIENT_ID,
                    client_secret: GITHUB_CLIENT_SECRET,
                    code
                })
        
                if (message) {
                    throw new Error(message)
                }
        
                let latestUserInfo = {
                    name,
                    githubLogin: login,
                    githubToken: access_token,
                    avatar: avatar_url
                }
        
                const { ops:[user] } = await db
                    .collection('users')
                    .replaceOne({ githubLogin: login }, latestUserInfo, { upsert: true })
        
                return { user, token: access_token }
            },
            async postPhoto(parent, args, { db, currentUser }) {
                if (!currentUser) {
                    throw new Error('only an authorized user can post a photo')
                }
                const newPhoto = {
                    ...args.input,
                    userID: currentUser.githubLogin,
                    created: new Date()
                }
                const { insertedIds } = await db.collection('photos').insert(newPhoto)
                newPhoto.id = insertedIds[0]
                return newPhoto
            },
            addFakeUsers: async (root, { count }, { db }) => {
                var randomUserApi = 'https://randomuser.me/api/?results=${count}'
                var { results } = await fetch(randomUserApi)
                    .then(res => res.json())
                var users = results.map(r => ({
                    githubLogin: r.login.username,
                    name: `${r.name.first} ${r.name.last}`,
                    avatar: r.picture.thumbnail,
                    githubToken: r.login.sha1
                }))
                await db.collection('users').insert(users)
                return users
            },
            fakeUserAuth: async (parent, { githubLogin }, { db }) => {
                var user = await db.collection('users').findOne({ githubLogin })
                if (!user) {
                    throw new Error(`Cannot find user with githubLogin ${githubLogin}`)
                }
                return {
                    token: user.githubToken,
                    user
                }
            }
        },
        Photo: {
            id: parent => parent.id || parent._id,
            url: parent => `/img/photos/${parent._id}.jpg`,
            postedBy: (parent, args, { db }) =>
                db.collection('users').findOne({ githubLogin: parent.userID }),
            taggedUsers: parent => tags
                .filter(tag => tag.photoID === parent.id)
                .map(tag => tag.userID)
                .map(userID => users.find(u => u.githubLogin === userID))
        },
        User: {
            postedPhotos: parent => {
                return photos.filter(p => p.githubUser === parent.githubLogin)
            },
            inPhotos: parent => tags
                .filter(tag => tag.userID === parent.id)
                .map(tag => tag.photoID)
                .map(photoID => photos.find(p => p.id === photoID))
        },
        DateTime: new GraphQLScalarType({
            name: `DateTime`,
            description: `A valid date time value.`,
            parseValue: value => new Date(value),
            serialize: value => new Date(value).toISOString(),
            parseLiteral: ast => ast.value
        })
    }

    const server = new ApolloServer({
        typeDefs,
        resolvers,
        context: async ({ req }) => {
            const githubToken = req.headers.authorization
            const currentUser = await db.collection('users').findOne({ githubToken })
            return { db, currentUser }
        }
    })
    server.applyMiddleware({ app })
    app.get(`/`, (req, res) => {
        let url = `https://github.com/login/oauth/authorize?client_id=${process.env.CLIENT_ID}&scope=user`
        res.end(`<a href="${url}">Sign In with Github</a>`)
    })
    app.get(`/playground`, expressPlayground({ endpoint: `/graphql` }))
    app.listen({ port: 4000 }, () => 
        console.log(`GraphQL Server running @ http://localhost:4000${server.graphqlPath}`)
    )
}

start()
