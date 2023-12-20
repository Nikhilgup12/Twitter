const express = require('express')
const path = require('path')
const sqlite3 = require('sqlite3')
const {open} = require('sqlite')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const dbpath = path.join(__dirname, 'twitterClone.db')
const app = express()
app.use(express.json())
let db = null
const initalize = async () => {
  try {
    db = await open({
      filename: dbpath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server is start!!')
    })
  } catch (e) {
    console.log(`Error message ${e.message}`)
    process.exit(1)
  }
}
initalize()

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const hasPassword = await bcrypt.hash(password, 10)
  const selectQuery = `select * from user where username = '${username}';`
  const dbuser = await db.get(selectQuery)
  if (dbuser === undefined) {
    if (password.length < 6) {
      response.status(400)
      response.send('password is too short')
    } else {
      const createQuery = `insert into user (username,password,name,gender)
                             values(
                                '${username}',
                                '${hasPassword}',
                                '${name}',
                                '${gender}'
                             )`
      await db.all(createQuery)
      response.status(200)
      response.send('User created successfully')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const selectQuery = `select * from user where username = '${username}';`
  const dbuser = await db.get(selectQuery)
  if (dbuser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordmatched = await bcrypt.compare(password, dbuser.password)
    if (isPasswordmatched === true) {
      const payload = {username: username, userId: dbuser.user_id}
      const jwtToken = jwt.sign(payload, 'My_Secret_Token')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

const AuthenticationToken = (request, response, next) => {
  let jwtToken
  const authHeaders = request.headers['authorization']
  if (authHeaders !== undefined) {
    jwtToken = authHeaders.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'My_Secret_Token', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        request.userId = payload.userId
        next()
      }
    })
  }
}

app.get(
  '/user/tweets/feed/',
  AuthenticationToken,
  async (request, response) => {
    const {
      order = ' DESC',
      limit = 4,
      order_by = 'tweet.date_time',
    } = request.query
    const {userId} = request
    const tweetsQuery = `
            SELECT user.username, tweet.tweet, tweet.date_time AS dateTime
            FROM follower INNER JOIN tweet
           ON follower.following_user_id = tweet.user_id
         INNER JOIN user ON tweet.user_id = user.user_id
      WHERE follower.follower_user_id = ${userId}
      ORDER BY ${order_by} ${order} limit ${limit}`
    const data = await db.all(tweetsQuery)
    response.send(data)
  },
)

const tweetAcessVerification = async (request, response, next) => {
  const {userId} = request
  const {tweetId} = request.params
  const tweetQuery = `select * from tweet inner join follower on tweet.user_id = follower.following_user_id 
                      where tweet.tweet_id =${tweetId} and follower_user_id = ${userId};`
  const tweet = await db.get(tweetQuery)
  if (tweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}

app.get('/user/following/', AuthenticationToken, async (request, response) => {
  let {userId} = request
  const getQuery = `select name from user inner join follower on user.user_id = follower.following_user_id
                     where follower_user_id = ${userId};`
  const user = await db.all(getQuery)
  response.send(user)
})

app.get('/user/followers/', AuthenticationToken, async (request, response) => {
  let {userId} = request
  const getQuery = `select name from user inner join follower on user.user_id = follower.follower_user_id
                     where following_user_id = ${userId};`
  const user = await db.all(getQuery)
  response.send(user)
})

// API 6

app.get(
  '/tweets/:tweetId/',
  AuthenticationToken,
  tweetAcessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const getTweetQuery = `select tweet, (select count() from like where tweet_id = ${tweetId}) as likes,
                         (select count() from reply where tweet_id = ${tweetId}) as replies, 
                         date_time as dateTime from tweet`
    const tweet = await db.get(getTweetQuery)
    response.send(tweet)
  },
)

// API 7

app.get(
  '/tweets/:tweetId/likes/',
  AuthenticationToken,
  tweetAcessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const getTweetQuery = `select username from user inner join like on user.user_id = like.user_id
                          where tweet_id = ${tweetId};`
    const tweet = await db.get(getTweetQuery)
    const user = tweet.map(each => each.username)
    response.send({likes: user})
  },
)

app.get(
  '/tweets/:tweetId/replies/',
  AuthenticationToken,
  tweetAcessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const getTweetQuery = `select name,reply from user inner join reply on user.user_id = reply.user_id
                          where tweet_id = ${tweetId};`
    const reply = await db.all(getTweetQuery)
    response.send({replies: reply})
  },
)

app.get('/user/tweets/', AuthenticationToken, async (request, response) => {
  const {userId} = request
  const getTweetQuery = `select tweet, count(distinct like_id) as likes,
                          count(distinct reply_id) as replies, date_time as dateTime
                          from tweet left join like on tweet.tweet_id = like.tweet_id 
                          left join reply on tweet.tweet_id = reply.tweet_id 
                          where tweet.user_id =${userId} group by tweet.tweet_id;`
  const tweet = await db.all(getTweetQuery)
  response.send(tweet)
})

app.post('/user/tweets/', AuthenticationToken, async (request, response) => {
  const {tweet} = request.body
  const createTweet = `insert into tweet (tweet) values('${tweet}');`
  await db.run(createTweet)
  response.send('Created a Tweet')
})

app.delete(
  '/tweets/:tweetId/',
  AuthenticationToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {userId} = request
    const deleteTweet = `delete from tweet where user_id = ${userId} and tweet_id = ${tweetId};`
    const tweet = await db.get(deleteTweet)
    if (tweet === undefined) {
      response.status(401)
      response.send('Tweet Removed')
    } else {
      const deleteTweet = `delete from tweet where tweet_id = ${tweetId};`
      await db.run(deleteTweet)
      response.send('Tweet Removed')
    }
  },
)
module.exports = app
