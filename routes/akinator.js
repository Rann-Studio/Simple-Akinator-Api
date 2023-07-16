const express = require('express')
const router = express.Router()

const uuid = require('uuid')
const mysql = require('mysql')


class Database {
    constructor() {
        this.pool = mysql.createPool({
            host: 'localhost',
            user: 'root',
            password: '',
            database: 'akinator',
        })
    }

    async init() {
        await this.query(`
            CREATE TABLE IF NOT EXISTS characters (
                id INT PRIMARY KEY AUTO_INCREMENT,
                character_name VARCHAR(255) UNIQUE
            )
        `)

        await this.query(`
            CREATE TABLE IF NOT EXISTS questions (
                id INT PRIMARY KEY AUTO_INCREMENT,
                question VARCHAR(100) UNIQUE
            )
        `)

        // answer is boolean true (1) or false (0)
        await this.query(`
            CREATE TABLE IF NOT EXISTS answers (
                id INT PRIMARY KEY AUTO_INCREMENT,
                question_id INT,
                character_id INT,
                answer TINYINT(1) NOT NULL,
                FOREIGN KEY (question_id) REFERENCES questions(id),
                FOREIGN KEY (character_id) REFERENCES characters(id)
            )
        `)
    }

    query(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.pool.query(sql, params, (error, results) => {
                if (error) {
                    reject(error)
                } else {
                    resolve(results)
                }
            })
        })
    }
}


class Akinator {
    constructor() {
        this.gameSession = uuid.v4()
        this.answerData = []
    }

    addAnswerData(question_id, answer) {
        const existingAnswerIndex = this.answerData.findIndex(data => data.question_id === question_id);

        if (existingAnswerIndex !== -1) {
            this.answerData[existingAnswerIndex].answer = answer;
        } else {
            this.answerData.push({ question_id, answer });
        }
    }

    getAnswerData() {
        return this.answerData
    }

}


const db = new Database()
db.init()

const ongoingGame = {}

router.get('/start', function (req, res, next) {
    const akinator = new Akinator()
    ongoingGame[akinator.gameSession] = akinator

    return res.status(200).json({
        sessionId: akinator.gameSession
    })
})


router.get('/:gameSession/question', async function (req, res, next) {
    const gameSession = req.params.gameSession
    const akinator = ongoingGame[gameSession]

    if (!akinator) {
        return res.status(400).json({
            error: 'invalid game session'
        })
    }

    const answeredQuestionIds = akinator.getAnswerData().map(answer => answer.question_id);
    let randomQuestionQuery = '';
    if (answeredQuestionIds.length > 0) {
        randomQuestionQuery = 'SELECT * FROM questions WHERE id NOT IN (?) ORDER BY RAND() LIMIT 1'
    } else {
        randomQuestionQuery = 'SELECT * FROM questions ORDER BY RAND() LIMIT 1'
    }

    db.query(randomQuestionQuery, [answeredQuestionIds])
        .then((result) => {
            return res.status(200).json({
                data: result
            })
        }).catch((err) => {
            return res.status(500).json({
                error: err.message
            })
        });

})


router.post('/:gameSession/answer', function (req, res, next) {
    const gameSession = req.params.gameSession
    const akinator = ongoingGame[gameSession]

    if (!akinator) {
        return res.status(400).json({
            error: 'invalid game session'
        })
    }

    const { question_id, answer } = req.body;
    akinator.addAnswerData(question_id, answer)

    return res.status(200).json({
        message: 'answers has been recorded'
    })
})


router.get('/:gameSession/end', async function (req, res, next) {
    const gameSession = req.params.gameSession
    const akinator = ongoingGame[gameSession]

    if (!akinator) {
        return res.status(400).json({
            error: 'invalid game session'
        })
    }

    delete ongoingGame[gameSession]

    const answerData = akinator.getAnswerData()
    const questionIds = answerData.map(answer => answer.question_id);
    const answers = answerData.map(answer => answer.answer);

    const guessQuery = `
        SELECT character_name
        FROM characters
        INNER JOIN answers ON characters.id = answers.character_id
        WHERE answers.question_id IN (?) AND answers.answer IN (?)
        GROUP BY character_id
        HAVING COUNT(DISTINCT answers.question_id) = ?
    `;
    db.query(guessQuery, [questionIds, answers, questionIds.length])
        .then((result) => {
            if (result.length > 0) {
                return res.status(200).json({
                    message: 'game ended successfully',
                    guess: result[0].character_name
                });
            } else {
                return res.status(404).json({
                    message: 'game ended successfully',
                    guess: "sorry, i couldn't guess the character."
                });
            }
        })
        .catch((error) => {
            return res.status(500).json({
                error: error.message
            });
        });
})


module.exports = router